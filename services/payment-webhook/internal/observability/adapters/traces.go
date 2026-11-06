package adapters

// Traces: one TracerProvider over the shared resource — ParentBased sampling
// with the configured ratio, one BatchSpanProcessor under the flush cap —
// holding the tracer the instruments build spans from. Skeleton: lands with
// the OTel SDK wiring.
