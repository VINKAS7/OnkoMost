"""One shared connection to InterSystems IRIS: SQL through the DB-API and globals through the native API.

The API threads and the document worker thread share it behind a lock (Community Edition allows only a few
connections). A dropped connection is reopened once and the call retried.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Callable, Iterator, TypeVar

import iris

from backend.config import settings

T = TypeVar("T")


class Iris:
    def __init__(self) -> None:
        self._conn = None
        self._native = None
        self._lock = threading.RLock()

    def _connect(self) -> None:
        self._conn = iris.connect(hostname=settings.iris_host, port=settings.iris_port,
                                  namespace=settings.iris_namespace, username=settings.iris_user,
                                  password=settings.iris_password)
        self._native = iris.createIRIS(self._conn)

    def _close(self) -> None:
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:  # noqa: BLE001
            pass
        self._conn = self._native = None

    def _call(self, fn: Callable[[], T]) -> T:
        with self._lock:
            if self._conn is None:
                self._connect()
            try:
                return fn()
            except (OSError, ConnectionError, RuntimeError):
                # stale socket (IRIS restarted, WSL suspended…): reconnect once
                self._close()
                self._connect()
                return fn()

    @contextmanager
    def native(self) -> Iterator[Any]:
        """The native API handle (globals), held under the lock for the whole block."""
        with self._lock:
            if self._conn is None:
                self._connect()
            try:
                yield self._native
            except (OSError, ConnectionError, RuntimeError):
                self._close()  # reconnect on the next call
                raise

    @contextmanager
    def transaction(self) -> Iterator[Any]:
        """Globals written inside the block are committed together or not at all."""
        with self.native() as n:
            n.tStart()
            try:
                yield n
                n.tCommit()
            except Exception:
                n.tRollback()
                raise

    def sql(self, query: str, params: list | tuple = ()) -> list[tuple]:
        def run():
            cur = self._conn.cursor()
            try:
                cur.execute(query, list(params))
                return [tuple(r) for r in cur.fetchall()] if cur.description else []
            finally:
                cur.close()
        return self._call(run)

    def sql_many(self, query: str, rows: list[list]) -> None:
        if not rows:
            return

        def run():
            cur = self._conn.cursor()
            try:
                cur.executemany(query, rows)
            finally:
                cur.close()
        self._call(run)


db = Iris()
