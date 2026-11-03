package factories

import "fmt"

// AWSClientFactory resolves the region and optional endpoint override; credentials never enter the config planes.
type AWSClientFactory struct{}

func NewAWSClientFactory() (*AWSClientFactory, error) {
	return nil, fmt.Errorf("config: AWSClientFactory is a skeleton; lands with the AWS build")
}
