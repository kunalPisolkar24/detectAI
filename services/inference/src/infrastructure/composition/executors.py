import concurrent.futures


def create_model_executors(max_workers: int):
    spark_workers = max(4, max_workers // 2)
    flare_workers = max(4, max_workers - spark_workers)
    spark_ex = concurrent.futures.ThreadPoolExecutor(max_workers=spark_workers, thread_name_prefix="spark-pool")
    flare_ex = concurrent.futures.ThreadPoolExecutor(max_workers=flare_workers, thread_name_prefix="flare-pool")
    return spark_ex, flare_ex
