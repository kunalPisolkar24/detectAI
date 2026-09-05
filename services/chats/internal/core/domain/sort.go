package domain

import "sort"

// SortMessagesDesc sorts messages in-place descending by CreatedAt, tie-broken by ID descending.
// Uses unstable sort because tie-break makes order deterministic.
func SortMessagesDesc(msgs []*Message) {
	sort.Slice(msgs, func(i, j int) bool {
		if msgs[i].CreatedAt.Equal(msgs[j].CreatedAt) {
			return msgs[i].ID > msgs[j].ID
		}
		return msgs[i].CreatedAt.After(msgs[j].CreatedAt)
	})
}
