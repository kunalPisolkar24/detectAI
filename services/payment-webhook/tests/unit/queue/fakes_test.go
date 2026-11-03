package queue_test

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/smithy-go"
)

// fakeSQS embeds the SDK client interface so unstubbed methods panic.
type fakeSQS struct {
	sqs.Client
	input *sqs.SendMessageInput
	err   error
}

func (f *fakeSQS) SendMessage(ctx context.Context, params *sqs.SendMessageInput, optFns ...func(*sqs.Options)) (*sqs.SendMessageOutput, error) {
	f.input = params
	return &sqs.SendMessageOutput{}, f.err
}

// apiErr fakes the smithy shape the adapter's code mapping reads.
type apiErr struct {
	code string
	msg  string
}

func (e *apiErr) Error() string                 { return e.msg }
func (e *apiErr) ErrorCode() string             { return e.code }
func (e *apiErr) ErrorMessage() string          { return e.msg }
func (e *apiErr) ErrorFault() smithy.ErrorFault { return smithy.FaultServer }
