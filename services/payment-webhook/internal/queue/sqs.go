package queue

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	"github.com/aws/smithy-go"
)

// SQSMessageCeiling is the largest body SQS accepts per message; a larger publish can never succeed.
const SQSMessageCeiling = 256 << 10 // 256 KiB

// SQSClient is the transport interface; the SDK ships no service-wide equivalent.
type SQSClient interface {
	SendMessage(ctx context.Context, params *sqs.SendMessageInput, optFns ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
}

// SQSAdapter publishes one message per call; the send response is the durability point.
type SQSAdapter struct {
	client SQSClient
	url    string
}

func NewSQSAdapter(client SQSClient, url string) *SQSAdapter {
	return &SQSAdapter{client: client, url: url}
}

// Publish maps throttling, the other retryable SQS codes, and transport outages
// onto ErrEnqueueUnavailable — the same 503 + Retry-After as throttling. Dead
// contexts and the remaining codes stay unmapped: a crossed deadline is the
// Service's timeout verdict, and a code that can never succeed must not
// advertise a retry.
func (a *SQSAdapter) Publish(ctx context.Context, message Message) error {
	input := &sqs.SendMessageInput{
		QueueUrl:               aws.String(a.url),
		MessageBody:            aws.String(string(message.Body)),
		MessageDeduplicationId: aws.String(message.DedupID),
		MessageGroupId:         aws.String(message.GroupID),
		MessageAttributes:      messageAttributes(message),
	}
	if _, err := a.client.SendMessage(ctx, input); err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return err
		}
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			switch apiErr.ErrorCode() {
			case "ThrottlingException", "InternalFailure", "ServiceUnavailable":
				return ErrEnqueueUnavailable
			}
			return err
		}
		return ErrEnqueueUnavailable
	}
	return nil
}

// messageAttributes always sets source and event_type; blank optional ids omit the attribute.
func messageAttributes(message Message) map[string]types.MessageAttributeValue {
	attributes := map[string]types.MessageAttributeValue{
		"source":     stringAttribute(message.Source),
		"event_type": stringAttribute(message.EventType),
	}
	for name, value := range map[string]string{
		"event_id":        message.EventID,
		"occurred_at":     message.OccurredAt,
		"subscription_id": message.SubscriptionID,
		"transaction_id":  message.TransactionID,
		"customer_id":     message.CustomerID,
		"user_id":         message.UserID,
	} {
		if value != "" {
			attributes[name] = stringAttribute(value)
		}
	}
	return attributes
}

func stringAttribute(value string) types.MessageAttributeValue {
	return types.MessageAttributeValue{DataType: aws.String("String"), StringValue: aws.String(value)}
}
