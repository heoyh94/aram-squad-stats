import unittest
from unittest.mock import Mock, patch
import requests
import lcu_agent as agent


class IncrementalSyncTests(unittest.TestCase):
    def test_checkpoint_comes_from_complete_server_match_not_run_time(self):
        session = Mock()
        session.get.return_value.json.return_value = {'last_played_at': '2026-09-14T12:11:57.327+00:00', 'last_match_id': 'OC1_1', 'revision': 'complete'}
        checkpoint = agent.get_sync_checkpoint(session)
        self.assertEqual(checkpoint['gameId'], 'OC1_1')
        self.assertEqual(checkpoint['creation'], 1789387917327)
        session.get.return_value.json.return_value['revision'] = None
        self.assertIsNone(agent.get_sync_checkpoint(session))

    def test_more_than_eight_new_games_are_kept_and_pages_continue_to_checkpoint(self):
        page1 = [{'gameId': i, 'gameCreation': i * 1000} for i in range(50, 30, -1)]
        page2 = [{'gameId': i, 'gameCreation': i * 1000} for i in range(30, 10, -1)]
        checkpoint = {'gameId': 'OC1_25', 'creation': 25000}
        with patch.object(agent, 'get_match_history', side_effect=[page1, page2]) as fetch:
            games, reached = agent.collect_since_checkpoint(Mock(), 'player', checkpoint)
        self.assertTrue(reached)
        self.assertEqual(fetch.call_count, 2)
        candidates = agent.after_checkpoint(games, checkpoint)
        self.assertEqual(len(agent.pending_games(candidates, {'OC1_25'})), 25)

    def test_ignored_pagination_is_not_reported_as_complete(self):
        page = [{'gameId': i, 'gameCreation': i * 1000} for i in range(50, 30, -1)]
        with patch.object(agent, 'get_match_history', return_value=page) as fetch:
            games, reached = agent.collect_since_checkpoint(Mock(), 'player', {'gameId': 'OC1_1', 'creation': 1000})
        self.assertFalse(reached)
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(len(games), 20)

    def test_exact_timestamp_and_unknown_timestamp_are_not_skipped(self):
        games = [{'gameId': 1, 'gameCreation': 10}, {'gameId': 2, 'gameCreation': 20}, {'gameId': 3, 'gameCreation': 0}]
        self.assertEqual(agent.after_checkpoint(games, {'creation': 20}), games[1:])
        self.assertEqual(agent.after_checkpoint(games, {'creation': 20}, full=True), games)

    def test_current_account_route_is_used_before_cached_puuid_route(self):
        with patch.object(agent, 'lcu_get', return_value={'games': {'games': []}}) as get:
            agent.get_match_history(Mock(), 'player', begin=20)
        self.assertIn('/current-summoner/matches?begIndex=20&endIndex=39', get.call_args.args[1])

    def test_status_requests_are_chunked_when_more_than_twenty_games_are_pending(self):
        session = Mock()
        session.post.return_value.json.return_value = {'complete_match_ids': []}
        agent.get_completed_match_ids(session, [{'gameId': i} for i in range(45)], 'test-only')
        self.assertEqual([len(call.kwargs['json']['match_ids']) for call in session.post.call_args_list], [20, 20, 5])

    def test_finished_game_is_retried_until_it_appears(self):
        with patch.object(agent, 'get_game_detail', return_value={}), patch.object(agent, 'get_match_history', return_value=[{'gameId': 2}]), patch.object(agent.time, 'sleep'):
            games, ready = agent.wait_for_finished_game(Mock(), 'player', 2, [{'gameId': 1}])
        self.assertTrue(ready)
        self.assertEqual({g['gameId'] for g in games}, {1, 2})

    def test_waiting_for_results_times_out_without_reporting_success(self):
        with patch.object(agent, 'get_game_detail', return_value={}), patch.object(agent.time, 'monotonic', side_effect=[0, 21]):
            games, ready = agent.wait_for_finished_game(Mock(), 'player', 2, [{'gameId': 1}])
        self.assertFalse(ready)
        self.assertEqual(games, [{'gameId': 1}])

    def test_two_or_three_missed_games_are_all_kept(self):
        games = [{'gameId': i} for i in range(8)]
        self.assertEqual(agent.pending_games(games, {f'OC1_{i}' for i in range(5)}), games[5:])

    def test_status_failure_never_becomes_saved_confirmation(self):
        session = Mock()
        session.post.return_value.raise_for_status.side_effect = requests.HTTPError('offline')
        with self.assertRaises(requests.HTTPError):
            agent.get_completed_match_ids(session, [{'gameId': 1}], 'test-only')

    def test_ignore_unrequested_ids_and_validate_response(self):
        session = Mock()
        session.post.return_value.json.return_value = {'complete_match_ids': ['OC1_1', 'OC1_99']}
        self.assertEqual(agent.get_completed_match_ids(session, [{'gameId': 1}], 'test-only'), {'OC1_1'})
        session.post.return_value.json.return_value = {'complete_match_ids': 'OC1_1'}
        with self.assertRaises(ValueError):
            agent.get_completed_match_ids(session, [{'gameId': 1}], 'test-only')

    def test_empty_history_needs_no_server_request(self):
        session = Mock()
        self.assertEqual(agent.get_completed_match_ids(session, [], 'test-only'), set())
        session.post.assert_not_called()

    def test_inclusive_history_endpoint_is_capped_and_supports_both_shapes(self):
        games = [{'gameId': i} for i in range(21)]
        for data in ({'games': {'games': games}}, {'games': games}, games):
            with patch.object(agent, 'lcu_get', return_value=data):
                self.assertEqual(len(agent.get_match_history(Mock(), 'player', 20)), 20)


if __name__ == '__main__':
    unittest.main()
