package factories

import "fmt"

// DevSource is the dev plane: the process environment over the parsed dotenv file
// (env wins — a container ships no file and receives its values injected).
type DevSource struct {
	values map[string]string
}

// NewDevSource parses the dotenv plane once and merges the process env over it;
// a missing default file is an empty file plane, a malformed one fails the boot.
func NewDevSource(dotenvPath string, environ []string) (*DevSource, error) {
	return nil, fmt.Errorf("config: NewDevSource is a skeleton; the wire-up build merges the dotenv plane and the environment")
}

// Get answers from the merged plane values.
func (s *DevSource) Get(key string) (string, bool) {
	value, ok := s.values[key]
	return value, ok
}
