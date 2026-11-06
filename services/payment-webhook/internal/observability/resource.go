package observability

// resource stamps one shared identity per process — service.name,
// service.version ("dev" when unset), and the flick supplying
// deployment.environment: direct push means the app owns the labels the
// in-stack collector used to upsert. Skeleton: lands with the OTel SDK wiring.
