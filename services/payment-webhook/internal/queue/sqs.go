package queue

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	"github.com/aws/smithy-go"
)

// SQSMessageCeiling is the largest body SQS accepts per message: a bigger
// publish can never succeed, so the reader wiring clamps down to it and the
// caller meets the shaped 413 instead of a mid-budget send fault.
const SQSMessageCeiling = 256 << 10 // 256 KiB

// SQSClient is the transport seam: the SDK's *sqs.Client satisfies it
// structurally, and adapter tests inject fakes. The SDK no longer ships a
// service-wide interface, so the queue package defines the one method it uses.
type SQSClient interface {
	SendMessage(ctx context.Context, params *sqs.SendMessageInput, optFns ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
}

// SQSAdapter binds Queue to the FIFO queue URL: one SendMessage per publish,
// whose success response is the durability guarantee. SDK types are converted
// here and nowhere else.
type SQSAdapter struct {
	client SQSClient
	url    string
}

// NewSQSAdapter binds the SDK client and the queue URL.
func NewSQSAdapter(client SQSClient, url string) *SQSAdapter {
	return &SQSAdapter{client: client, url: url}
}

// Publish sends the message: a throttled, outaged, or internally-failing SQS
// answers ErrEnqueueUnavailable (the retryable rows), a crossed deadline
// passes through for the Service to map, and anything unexpected goes unmapped
// to the 500 catch-all per the taxonomy.
func (a *SQSAdapter) Publish(ctx context.Context, message Message) error {
	input := &sqs.SendMessageInput{
		QueueUrl:               aws.String(a.url),
		MessageBody:            aws.String(string(message.Body)),
		MessageDeduplicationId: aws.String(message.DedupID),
		MessageGroupId:         aws.String(message.GroupID),
		MessageAttributes:      messageAttributes(message),
	}
	if _, err := a.client.SendMessage(ctx, input); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			switch apiErr.ErrorCode() {
			case "ThrottlingException", "InternalFailure", "ServiceUnavailable":
				return ErrEnqueueUnavailable
			}
		}
		return err
	}
	return nil
}

// messageAttributes converts the three contract attributes; event_id is
// omitted when absent, and no empty string value ever reaches SQS.
func messageAttributes(message Message) map[string]types.MessageAttributeValue {
	attributes := map[string]types.MessageAttributeValue{
		"source":     stringAttribute(message.Source),
		"event_type": stringAttribute(message.EventType),
	}
	if message.EventID != "" {
		attributes["event_id"] = stringAttribute(message.EventID)
	}
	return attributes
}

func stringAttribute(value string) types.MessageAttributeValue {
	return types.MessageAttributeValue{DataType: aws.String("String"), StringValue: aws.String(value)}
}
