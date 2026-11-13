# AWS for the autopilot (eu-central-1): cases arrive on SQS, a Lambda reads them with Claude on Bedrock and
# queues the work, a scheduled sweep escalates deadlines at risk, effects leave through an outbox table whose
# stream drives the sender, SARs are kept in an S3 bucket under object lock. Everything encrypted with one key.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { service = "regulated-ops-autopilot", owner = "process-engineering", data = "confidential" }
  }
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "lambda_zip" {
  description = "Bundled handlers; see docs/architecture.md for what is and is not built yet"
  type        = string
  default     = "../../dist/lambda.zip"
}

variable "bedrock_model_id" {
  type    = string
  default = "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
}

variable "sar_retention_years" {
  description = "GwG § 8: records kept for five years"
  type        = number
  default     = 5
}

data "aws_caller_identity" "me" {}

resource "aws_kms_key" "ops" {
  description         = "regulated-ops-autopilot data at rest"
  enable_key_rotation = true
}

resource "aws_sqs_queue" "dead" {
  name                      = "ops-cases-dead"
  kms_master_key_id         = aws_kms_key.ops.id
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "cases" {
  name                       = "ops-cases"
  kms_master_key_id          = aws_kms_key.ops.id
  visibility_timeout_seconds = 120
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dead.arn, maxReceiveCount = 5 })
}

resource "aws_dynamodb_table" "tasks" {
  name         = "ops-tasks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "task_id"
  attribute {
    name = "task_id"
    type = "S"
  }
  attribute {
    name = "queue"
    type = "S"
  }
  attribute {
    name = "deadline"
    type = "S"
  }
  global_secondary_index {
    name            = "by_deadline"
    hash_key        = "queue"
    range_key       = "deadline"
    projection_type = "ALL"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.ops.arn
  }
}

resource "aws_dynamodb_table" "outbox" {
  name             = "ops-outbox"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "effect_key"
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"
  attribute {
    name = "effect_key"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.ops.arn
  }
}

resource "aws_dynamodb_table" "audit" {
  name         = "ops-audit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "case_id"
  range_key    = "seq"
  attribute {
    name = "case_id"
    type = "S"
  }
  attribute {
    name = "seq"
    type = "N"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.ops.arn
  }
}

resource "aws_s3_bucket" "sars" {
  bucket              = "ops-sar-archive-${data.aws_caller_identity.me.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_object_lock_configuration" "sars" {
  bucket = aws_s3_bucket.sars.id
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = var.sar_retention_years
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sars" {
  bucket = aws_s3_bucket.sars.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.ops.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "sars" {
  bucket                  = aws_s3_bucket.sars.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name               = "ops-autopilot-worker"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

data "aws_iam_policy_document" "worker" {
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.cases.arn]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.tasks.arn, "${aws_dynamodb_table.tasks.arn}/index/*", aws_dynamodb_table.outbox.arn, aws_dynamodb_table.audit.arn]
  }
  statement {
    actions   = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"]
    resources = [aws_dynamodb_table.outbox.stream_arn]
  }
  statement {
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:*::foundation-model/*", "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.me.account_id}:inference-profile/*"]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.sars.arn}/*"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.ops.arn]
  }
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "worker" {
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

locals {
  handlers = {
    intake = { handler = "lambda.intake", timeout = 60 }
    sweep  = { handler = "lambda.sweep", timeout = 120 }
    sender = { handler = "lambda.sender", timeout = 60 }
  }
}

resource "aws_lambda_function" "fn" {
  for_each         = local.handlers
  function_name    = "ops-autopilot-${each.key}"
  role             = aws_iam_role.worker.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = each.value.handler
  filename         = var.lambda_zip
  source_code_hash = fileexists(var.lambda_zip) ? filebase64sha256(var.lambda_zip) : null
  timeout          = each.value.timeout
  kms_key_arn      = aws_kms_key.ops.arn
  environment {
    variables = {
      TASKS_TABLE  = aws_dynamodb_table.tasks.name
      OUTBOX_TABLE = aws_dynamodb_table.outbox.name
      AUDIT_TABLE  = aws_dynamodb_table.audit.name
      SAR_BUCKET   = aws_s3_bucket.sars.bucket
      MODEL_ID     = var.bedrock_model_id
    }
  }
}

resource "aws_lambda_event_source_mapping" "cases" {
  event_source_arn                   = aws_sqs_queue.cases.arn
  function_name                      = aws_lambda_function.fn["intake"].arn
  batch_size                         = 10
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 5
}

resource "aws_lambda_event_source_mapping" "outbox" {
  event_source_arn  = aws_dynamodb_table.outbox.stream_arn
  function_name     = aws_lambda_function.fn["sender"].arn
  starting_position = "LATEST"
  filter_criteria {
    filter {
      pattern = jsonencode({ eventName = ["INSERT", "MODIFY"], dynamodb = { NewImage = { confirmed_at = { NULL = [true] } } } })
    }
  }
}

resource "aws_cloudwatch_event_rule" "sweep" {
  name                = "ops-deadline-sweep"
  schedule_expression = "rate(15 minutes)"
}

resource "aws_cloudwatch_event_target" "sweep" {
  rule = aws_cloudwatch_event_rule.sweep.name
  arn  = aws_lambda_function.fn["sweep"].arn
}

resource "aws_lambda_permission" "sweep" {
  statement_id  = "events"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["sweep"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sweep.arn
}

resource "aws_cloudwatch_metric_alarm" "dead_letters" {
  alarm_name          = "ops-cases-dead-letters"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dead.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
}

output "cases_queue_url" {
  value = aws_sqs_queue.cases.url
}
