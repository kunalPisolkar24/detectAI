package coalescer

import (
	"context"
	"fmt"

	"golang.org/x/sync/singleflight"
)

type Coalescer interface {
	Do(ctx context.Context, key string, fn func(context.Context) (any, error)) (any, error)
}

type FlightGroup struct {
	group singleflight.Group
}

var _ Coalescer = (*FlightGroup)(nil)

func NewFlightGroup() *FlightGroup {
	return &FlightGroup{}
}

func (g *FlightGroup) Do(ctx context.Context, key string, fn func(context.Context) (any, error)) (any, error) {
	result := g.group.DoChan(key, func() (any, error) {
		return fn(ctx)
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-result:
		return res.Val, res.Err
	}
}

func Coalesce[T any](c Coalescer, ctx context.Context, key string, fn func(context.Context) (T, error)) (T, error) {
	var zero T
	value, err := c.Do(ctx, key, func(ctx context.Context) (any, error) {
		return fn(ctx)
	})
	if err != nil {
		return zero, err
	}
	typed, ok := value.(T)
	if !ok {
		return zero, fmt.Errorf("cache: unexpected coalesced value of type %T", value)
	}
	return typed, nil
}
