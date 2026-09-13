import unittest
from unittest.mock import Mock, patch
import requests
import lcu_agent as agent


class IncrementalSyncTests(unittest.TestCase):
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
