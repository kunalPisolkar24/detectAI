package cache_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
)

type acquireCall struct {
	key string
	ttl time.Duration
}

type releaseCall struct {
	key   string
	token string
}

type fakeLocker struct {
	acquireErrs []error
	onAcquire   func()
	releaseErr  error
	acquires    []acquireCall
	releases    []releaseCall
}

func (f *fakeLocker) Acquire(_ context.Context, key string, ttl time.Duration) (string, error) {
	f.acquires = append(f.acquires, acquireCall{key: key, ttl: ttl})
	if f.onAcquire != nil {
		f.onAcquire()
	}
	if len(f.acquireErrs) > 0 {
		err := f.acquireErrs[0]
		f.acquireErrs = f.acquireErrs[1:]
		if err != nil {
			return "", err
		}
	}
	return "token", nil
}

func (f *fakeLocker) Release(_ context.Context, key, token string) error {
	f.releases = append(f.releases, releaseCall{key: key, token: token})
	return f.releaseErr
}

func quickPolicy() lock.Policy {
	policy := lock.NewPolicy(time.Second)
	policy.BaseDelay = time.Millisecond
	policy.MaxDelay = 2 * time.Millisecond
	return policy
}

func TestExecuteRunsUnderTheLockAndReleasesIt(t *testing.T) {
	locker := &fakeLocker{}
	got, err := lock.Execute(context.Background(), locker, "key", quickPolicy(), func(context.Context) (string, error) {
		return "value", nil
	})
	if err != nil || got != "value" {
		t.Fatalf("Execute = (%q, %v), want (value, nil)", got, err)
	}
	if len(locker.acquires) != 1 || locker.acquires[0].key != "key" || locker.acquires[0].ttl != time.Second {
		t.Errorf("acquires = %+v, want one acquire with the policy TTL", locker.acquires)
	}
	if len(locker.releases) != 1 || locker.releases[0] != (releaseCall{key: "key", token: "token"}) {
		t.Errorf("releases = %+v, want a release with the acquired token", locker.releases)
	}
}

func TestExecuteRetriesAContendedLock(t *testing.T) {
	locker := &fakeLocker{acquireErrs: []error{lock.ErrLockHeld}}
	called := 0
	_, err := lock.Execute(context.Background(), locker, "key", quickPolicy(), func(context.Context) (int, error) {
		called++
		return called, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if called != 1 {
		t.Errorf("work ran %d times, want once", called)
	}
	if len(locker.acquires) != 2 {
		t.Errorf("acquires = %d, want the first try and one retry", len(locker.acquires))
	}
}

func TestExecuteFailsOpenOnALockerFault(t *testing.T) {
	locker := &fakeLocker{acquireErrs: []error{errors.New("redis is down")}}
	called := false
	_, err := lock.Execute(context.Background(), locker, "key", quickPolicy(), func(context.Context) (int, error) {
		called = true
		return 7, nil
	})
	if err != nil || !called {
		t.Fatalf("Execute = (_, %v), called = %v; want the work to run unlocked", err, called)
	}
	if len(locker.releases) != 0 {
		t.Errorf("releases = %+v, want none when the lock was never acquired", locker.releases)
	}
}

func TestExecuteFailsOpenAfterExhaustingRetries(t *testing.T) {
	held := []error{lock.ErrLockHeld, lock.ErrLockHeld, lock.ErrLockHeld}
	locker := &fakeLocker{acquireErrs: held}
	policy := quickPolicy()
	policy.MaxAttempts = 3
	called := false
	if _, err := lock.Execute(context.Background(), locker, "key", policy, func(context.Context) (int, error) {
		called = true
		return 0, nil
	}); err != nil {
		t.Fatal(err)
	}
	if !called || len(locker.acquires) != 3 {
		t.Errorf("called = %v, acquires = %d; want the work to run after three tries", called, len(locker.acquires))
	}
}

func TestExecuteReleasesWhenTheWorkFails(t *testing.T) {
	locker := &fakeLocker{}
	want := errors.New("source failed")
	_, err := lock.Execute(context.Background(), locker, "key", quickPolicy(), func(context.Context) (int, error) {
		return 0, want
	})
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if len(locker.releases) != 1 {
		t.Errorf("releases = %+v, want the lock released even on failure", locker.releases)
	}
}

func TestExecuteAbsorbsAReleaseFault(t *testing.T) {
	locker := &fakeLocker{releaseErr: errors.New("unlock failed")}
	_, err := lock.Execute(context.Background(), locker, "key", quickPolicy(), func(context.Context) (int, error) {
		return 1, nil
	})
	if err != nil {
		t.Errorf("err = %v, want the work's result to survive a release fault", err)
	}
}

func TestExecuteStopsOnAnAlreadyCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	locker := &fakeLocker{}
	called := false
	_, err := lock.Execute(ctx, locker, "key", quickPolicy(), func(context.Context) (int, error) {
		called = true
		return 0, nil
	})
	if !errors.Is(err, context.Canceled) || called || len(locker.acquires) != 0 {
		t.Errorf("err = %v, called = %v, acquires = %d; want the cancelled context to stop before acquiring", err, called, len(locker.acquires))
	}
}

func TestExecuteStopsWhenTheContextIsCancelledDuringRetry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	locker := &fakeLocker{acquireErrs: []error{lock.ErrLockHeld}, onAcquire: cancel}
	called := false
	_, err := lock.Execute(ctx, locker, "key", quickPolicy(), func(context.Context) (int, error) {
		called = true
		return 0, nil
	})
	if !errors.Is(err, context.Canceled) || called {
		t.Errorf("err = %v, called = %v; want the retry to stop on cancellation", err, called)
	}
}

func TestExecuteFailsOpenOnAFaultDuringRetry(t *testing.T) {
	locker := &fakeLocker{acquireErrs: []error{lock.ErrLockHeld, errors.New("redis is down")}}
	called := false
	_, err := lock.Execute(context.Background(), locker, "key", quickPolicy(), func(context.Context) (int, error) {
		called = true
		return 1, nil
	})
	if err != nil || !called || len(locker.acquires) != 2 {
		t.Errorf("err = %v, called = %v, acquires = %d; want the work unlocked after the retry fault", err, called, len(locker.acquires))
	}
}

func TestExecuteToleratesAZeroDelayPolicy(t *testing.T) {
	locker := &fakeLocker{acquireErrs: []error{lock.ErrLockHeld}}
	policy := quickPolicy()
	policy.BaseDelay = 0
	policy.MaxDelay = 0
	called := false
	_, err := lock.Execute(context.Background(), locker, "key", policy, func(context.Context) (int, error) {
		called = true
		return 1, nil
	})
	if err != nil || !called || len(locker.acquires) != 2 {
		t.Errorf("err = %v, called = %v, acquires = %d; want an immediate retry", err, called, len(locker.acquires))
	}
}
