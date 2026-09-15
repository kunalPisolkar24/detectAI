package domain

import "sort"

func SortMessagesDesc(msgs []*Message) {
	sort.Slice(msgs, func(i, j int) bool {
		if msgs[i].CreatedAt.Equal(msgs[j].CreatedAt) {
			return msgs[i].ID > msgs[j].ID
		}
		return msgs[i].CreatedAt.After(msgs[j].CreatedAt)
	})
}
