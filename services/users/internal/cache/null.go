package cache

import "context"

type NullConnection struct{}

var _ Connection = NullConnection{}

func (NullConnection) Ping(context.Context) error {
	return nil
}

func (NullConnection) Disconnect(context.Context) error {
	return nil
}
