package cache_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/coalescer"
)

type wrongTypeCoalescer struct{}

func (wrongTypeCoalescer) Do(context.Context, string, func(context.Context) (any, error)) (any, error) {
	return "not an int", nil
}

func TestCoalesceSharesOneFlight(t *testing.T) {
	group := coalescer.NewFlightGroup()
	var calls atomic.Int32
	var wg sync.WaitGroup
	results := make([]int, 16)

	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			value, err := coalescer.Coalesce(group, context.Background(), "key", func(context.Context) (int, error) {
				calls.Add(1)
				time.Sleep(10 * time.Millisecond)
				return 42, nil
			})
			if err != nil {
				t.Errorf("Coalesce: %v", err)
				return
			}
			results[i] = value
		}(i)
	}
	wg.Wait()

	if got := calls.Load(); got != 1 {
		t.Errorf("work ran %d times, want once", got)
	}
	for i, value := range results {
		if value != 42 {
			t.Errorf("result %d = %d, want 42", i, value)
		}
	}
}

func TestCoalescePropagatesTheError(t *testing.T) {
	group := coalescer.NewFlightGroup()
	want := errors.New("source failed")
	var calls atomic.Int32
	var wg sync.WaitGroup
	errs := make([]error, 4)

	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = coalescer.Coalesce(group, context.Background(), "key", func(context.Context) (int, error) {
				calls.Add(1)
				time.Sleep(10 * time.Millisecond)
				return 0, want
			})
		}(i)
	}
	wg.Wait()

	if got := calls.Load(); got != 1 {
		t.Errorf("work ran %d times, want once", got)
	}
	for i, err := range errs {
		if !errors.Is(err, want) {
			t.Errorf("error %d = %v, want %v", i, err, want)
		}
	}
}

func TestCoalesceReturnsWhenTheContextIsCancelled(t *testing.T) {
	group := coalescer.NewFlightGroup()
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	finished := make(chan error, 1)

	go func() {
		_, err := coalescer.Coalesce(group, ctx, "key", func(context.Context) (int, error) {
			close(started)
			time.Sleep(20 * time.Millisecond)
			return 1, nil
		})
		finished <- err
	}()

	<-started
	cancel()
	if err := <-finished; !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}

func TestCoalesceRejectsAnUnexpectedValueType(t *testing.T) {
	_, err := coalescer.Coalesce[int](wrongTypeCoalescer{}, context.Background(), "key", func(context.Context) (int, error) {
		return 0, nil
	})
	if err == nil || !strings.Contains(err.Error(), "unexpected coalesced value") {
		t.Errorf("err = %v, want a type mismatch error", err)
	}
}
