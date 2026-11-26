package observability

import (
	"context"
	"time"
)

// Telemetry is the app-facing seam; no OTel import reaches it.
type Telemetry interface {
	TrackRPC(ctx context.Context, procedure string) (context.Context, func(RPCStatus))

	RecordRPC(procedure string, code RPCStatus, duration time.Duration)

	RecordCacheOp(operation string, result CacheResult, duration time.Duration)

	RecordDatastoreOp(operation string, result DatastoreResult, duration time.Duration)

	RecordRateLimitRefusal(scope string)

	RecordValidationRejection(field string)

	Shutdown(ctx context.Context) error
}

type RPCStatus string

const (
	RPCStatusOK       RPCStatus = "ok"
	RPCStatusInternal RPCStatus = "internal"
)

type CacheResult string

const (
	CacheHit   CacheResult = "hit"
	CacheMiss  CacheResult = "miss"
	CacheOK    CacheResult = "ok"
	CacheError CacheResult = "error"
)

type DatastoreResult string

const (
	DatastoreOK            DatastoreResult = "ok"
	DatastoreNotFound      DatastoreResult = "not_found"
	DatastoreConflict      DatastoreResult = "conflict"
	DatastoreInvalidCursor DatastoreResult = "invalid_cursor"
	DatastoreUnavailable   DatastoreResult = "unavailable"
	DatastoreError         DatastoreResult = "error"
)

const (
	CacheOperationChat            = "chat"
	CacheOperationNegative        = "negative"
	CacheOperationPutNegative     = "put_negative"
	CacheOperationClearNegative   = "clear_negative"
	CacheOperationChatList        = "chat_list"
	CacheOperationHead            = "head"
	CacheOperationPutChat         = "put_chat"
	CacheOperationPutChatList     = "put_chat_list"
	CacheOperationPutHead         = "put_head"
	CacheOperationInvalidateMeta  = "invalidate_meta"
	CacheOperationInvalidateChat  = "invalidate_chat"
	CacheOperationInvalidateOwner = "invalidate_owner"
)

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
