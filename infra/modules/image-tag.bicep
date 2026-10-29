// Shared by infra/main.bicep and infra/cd.bicep.
// fail() aborts the deployment before a container revision is updated.
@export()
func requireImageTag(tag string, deploying bool) string =>
  (deploying && (empty(tag) || tag == 'initial'))
    ? fail(
        'containerImageTag must be the published commit SHA when deployContainerApp or deployMigrationJob is true. An empty tag or initial is refused.'
      )
    : tag
