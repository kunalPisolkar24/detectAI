// Package adapters owns one SDK provider per signal, each started once against
// the shared resource, exporter injected, drain within the shutdown budget.
// The Providers land with the OTel SDK wiring; the start-once, export-timeout,
// and drain-order contracts are fixed here.
package adapters
