locals {
  # One writer plus the declared readers, flattened because a resource cannot
  # carry for_each and count at the same time.
  writer_instances = {
    for key, cluster in var.clusters : "${cluster.name}-writer" => {
      cluster_key    = key
      engine         = cluster.engine
      identifier     = "${cluster.name}-writer"
      promotion_tier = 0
    }
  }

  reader_instances = merge([
    for key, cluster in var.clusters : {
      for index in range(cluster.num_read_replicas) :
      "${cluster.name}-reader-${index + 1}" => {
        cluster_key    = key
        engine         = cluster.engine
        identifier     = "${cluster.name}-reader-${index + 1}"
        promotion_tier = 1
      }
    }
  ]...)

  instances = merge(local.writer_instances, local.reader_instances)
}

resource "aws_db_subnet_group" "this" {
  for_each = var.clusters

  name        = "${each.value.name}-subnet-group"
  description = "Subnet group for the ${each.value.name} Aurora cluster"
  subnet_ids  = var.subnet_ids
}

resource "aws_rds_cluster" "this" {
  for_each = var.clusters

  cluster_identifier        = each.value.name
  engine                    = each.value.engine
  engine_version            = each.value.engine_version
  engine_mode               = "provisioned"
  database_name             = each.value.database_name
  master_username           = var.master_username
  master_password           = var.master_password
  port                      = each.value.port
  db_subnet_group_name      = aws_db_subnet_group.this[each.key].name
  vpc_security_group_ids    = var.security_group_ids
  storage_encrypted         = each.value.storage_encrypted
  backup_retention_period   = each.value.backup_retention_days
  deletion_protection       = each.value.deletion_protection
  skip_final_snapshot       = each.value.skip_final_snapshot
  final_snapshot_identifier = each.value.skip_final_snapshot ? null : "${each.value.name}-final"

  serverlessv2_scaling_configuration {
    min_capacity = each.value.min_acu
    max_capacity = each.value.max_acu
  }
}

resource "aws_rds_cluster_instance" "this" {
  for_each = local.instances

  identifier         = each.value.identifier
  cluster_identifier = aws_rds_cluster.this[each.value.cluster_key].id
  engine             = each.value.engine
  instance_class     = "db.serverless"
  promotion_tier     = each.value.promotion_tier
}
