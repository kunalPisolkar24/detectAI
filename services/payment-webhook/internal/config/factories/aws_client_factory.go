package factories

import "fmt"

// AWSClientFactory resolves the bootstrap variables once — AWS_REGION (mandatory
// when prod fetches AWS) and the endpoint override that points a prod-config
// fetch at an emulator. Credentials ride the ambient chain and never enter the
// config planes.
type AWSClientFactory struct{}

// NewAWSClientFactory reads the bootstrap variables from the process environment
// and holds the AWS service clients the plane adapters need.
func NewAWSClientFactory() (*AWSClientFactory, error) {
	return nil, fmt.Errorf("config: AWSClientFactory is a skeleton; lands with the AWS build")
}
