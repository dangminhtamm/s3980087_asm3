"""Build CloudFleet's versioned daily analytics rollup with EMR Serverless.

The dashboard API aggregates this compact, non-PII snapshot for arbitrary date
ranges and regions. Spark does the expensive DynamoDB export scan only once.
"""

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone

import boto3
from pyspark.sql import SparkSession
from pyspark.sql import functions as F


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-uri", required=True)
    parser.add_argument("--output-bucket", required=True)
    parser.add_argument("--output-key", default="analytics/latest/overview.json")
    return parser.parse_args()


def load_orders(spark: SparkSession, input_uri: str):
    raw = spark.read.json(input_uri)

    # DynamoDB exports wrap values in AttributeValue objects. A flat branch is
    # also supported for local Spark fixtures.
    if "Item" in raw.columns:
        orders = raw.select(
            F.col("Item.orderId.S").alias("orderId"),
            F.col("Item.region.S").alias("region"),
            F.col("Item.status.S").alias("status"),
            F.col("Item.createdAt.S").alias("createdAt"),
            F.col("Item.deliveredAt.S").alias("deliveredAt"),
            F.col("Item.SK.S").alias("SK"),
        )
    else:
        orders = raw.select(
            "orderId", "region", "status", "createdAt", "deliveredAt", "SK"
        )

    return (
        orders.filter(F.col("SK") == "METADATA")
        .filter(F.col("orderId").isNotNull())
        .withColumn("region", F.coalesce(F.col("region"), F.lit("Unknown")))
        .withColumn("createdTs", F.to_timestamp("createdAt"))
        .withColumn("deliveredTs", F.to_timestamp("deliveredAt"))
        .filter(F.col("createdTs").isNotNull())
        .withColumn("date", F.date_format("createdTs", "yyyy-MM-dd"))
        .withColumn("hour", F.hour("createdTs"))
        .withColumn(
            "deliveryMinutes",
            F.when(
                F.col("deliveredTs").isNotNull(),
                (F.unix_timestamp("deliveredTs") - F.unix_timestamp("createdTs"))
                / 60.0,
            ),
        )
    )


def aggregate_rows(orders, grouping):
    return (
        orders.groupBy(*grouping)
        .agg(
            F.count("*").alias("orderCount"),
            F.sum(F.when(F.col("status") == "DELIVERED", 1).otherwise(0)).alias(
                "deliveredOrders"
            ),
            F.sum(F.coalesce("deliveryMinutes", F.lit(0.0))).alias(
                "totalDeliveryMinutes"
            ),
            F.count("deliveryMinutes").alias("deliveryDurationCount"),
        )
        .collect()
    )


def hourly_rows(orders, grouping):
    return (
        orders.groupBy(*grouping)
        .agg(F.count("*").alias("orderCount"))
        .collect()
    )


def build_snapshot(orders) -> dict:
    generated_at = datetime.now(timezone.utc)
    overall = aggregate_rows(orders, ["date"])
    regional = aggregate_rows(orders, ["date", "region"])
    daily_hourly = hourly_rows(orders, ["date", "hour"])
    regional_hourly = hourly_rows(orders, ["date", "region", "hour"])

    daily_hours = defaultdict(list)
    for row in daily_hourly:
        daily_hours[row.date].append(
            {"hour": int(row.hour), "orderCount": int(row.orderCount)}
        )

    region_hours = defaultdict(list)
    for row in regional_hourly:
        region_hours[(row.date, row.region)].append(
            {"hour": int(row.hour), "orderCount": int(row.orderCount)}
        )

    regions_by_date = defaultdict(list)
    for row in regional:
        regions_by_date[row.date].append(
            {
                "region": row.region,
                "orderCount": int(row.orderCount),
                "deliveredOrders": int(row.deliveredOrders or 0),
                "totalDeliveryMinutes": round(
                    float(row.totalDeliveryMinutes or 0), 2
                ),
                "deliveryDurationCount": int(row.deliveryDurationCount or 0),
                "hourlyOrderVolume": sorted(
                    region_hours[(row.date, row.region)], key=lambda item: item["hour"]
                ),
            }
        )

    daily = []
    for row in sorted(overall, key=lambda item: item.date):
        daily.append(
            {
                "date": row.date,
                "totalOrders": int(row.orderCount),
                "deliveredOrders": int(row.deliveredOrders or 0),
                "totalDeliveryMinutes": round(
                    float(row.totalDeliveryMinutes or 0), 2
                ),
                "deliveryDurationCount": int(row.deliveryDurationCount or 0),
                "hourlyOrderVolume": sorted(
                    daily_hours[row.date], key=lambda item: item["hour"]
                ),
                "regions": sorted(
                    regions_by_date[row.date], key=lambda item: item["region"]
                ),
            }
        )

    generated_day = generated_at.date().isoformat()
    return {
        "schemaVersion": 2,
        "generatedAt": generated_at.isoformat(),
        "coverage": {
            "from": daily[0]["date"] if daily else generated_day,
            "to": daily[-1]["date"] if daily else generated_day,
        },
        "daily": daily,
    }


def main() -> None:
    args = arguments()
    spark = SparkSession.builder.appName("CloudFleetDeliveryAnalytics").getOrCreate()
    try:
        snapshot = build_snapshot(load_orders(spark, args.input_uri))
        boto3.client("s3").put_object(
            Bucket=args.output_bucket,
            Key=args.output_key,
            Body=json.dumps(snapshot, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
