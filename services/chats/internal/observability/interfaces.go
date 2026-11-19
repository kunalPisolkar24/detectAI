// Package observability instruments the chats service.
package observability

import (
	"context"
	"time"
)

// Telemetry is the app-facing seam; no OTel import reaches it.
type Telemetry interface {
	// TrackRPC opens the procedure's server span; the closer ends it with the
	// RPC's final status.
	TrackRPC(ctx context.Context, procedure string) (context.Context, func(RPCStatus))

	// RecordRPC counts one answered RPC and times it.
	RecordRPC(procedure string, code RPCStatus, duration time.Duration)

	// RecordCacheOp counts one cache operation and times it.
	RecordCacheOp(operation string, result CacheResult, duration time.Duration)

	// RecordDatastoreOp counts one datastore operation and times it.
	RecordDatastoreOp(operation string, result DatastoreResult, duration time.Duration)

	// RecordRateLimitRefusal counts one exhausted burst budget.
	RecordRateLimitRefusal(scope string)

	// RecordValidationRejection counts one rejected payload field.
	RecordValidationRejection(field string)

	// Shutdown drains spans, metrics, and logs; export leftovers never fail the process.
	Shutdown(ctx context.Context) error
}

// RPCStatus is the wire code an RPC answered with; RPCStatusOK is the only success.
type RPCStatus string

const (
	// RPCStatusOK is the answer of a call that succeeded.
	RPCStatusOK RPCStatus = "ok"
	// RPCStatusInternal is the answer of a call that failed unexpectedly.
	RPCStatusInternal RPCStatus = "internal"
)

// CacheResult partitions the cache counter: reads answer hit or miss, writes answer ok.
type CacheResult string

const (
	CacheHit   CacheResult = "hit"
	CacheMiss  CacheResult = "miss"
	CacheOK    CacheResult = "ok"
	CacheError CacheResult = "error"
)

// DatastoreResult partitions the datastore counter by the outcome's class.
type DatastoreResult string

const (
	DatastoreOK            DatastoreResult = "ok"
	DatastoreNotFound      DatastoreResult = "not_found"
	DatastoreConflict      DatastoreResult = "conflict"
	DatastoreInvalidCursor DatastoreResult = "invalid_cursor"
	DatastoreUnavailable   DatastoreResult = "unavailable"
	DatastoreError         DatastoreResult = "error"
)

// The cache operation vocabulary: the three reads, the three writes, the three invalidations.
const (
	CacheOperationChat            = "chat"
	CacheOperationChatList        = "chat_list"
	CacheOperationHead            = "head"
	CacheOperationPutChat         = "put_chat"
	CacheOperationPutChatList     = "put_chat_list"
	CacheOperationPutHead         = "put_head"
	CacheOperationInvalidateMeta  = "invalidate_meta"
	CacheOperationInvalidateChat  = "invalidate_chat"
	CacheOperationInvalidateOwner = "invalidate_owner"
)

// The datastore operation vocabulary: one entry per repository contract method.
const (
	DatastoreOperationCreateChat          = "create_chat"
	DatastoreOperationChat                = "chat"
	DatastoreOperationChats               = "chats"
	DatastoreOperationRenameChat          = "rename_chat"
	DatastoreOperationDeleteChat          = "delete_chat"
	DatastoreOperationSaveUserMessage     = "save_user_message"
	DatastoreOperationSaveAnalysisMessage = "save_analysis_message"
	DatastoreOperationChatHistory         = "chat_history"
)
