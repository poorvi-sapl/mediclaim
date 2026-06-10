"""Deterministic mock helper shared by the registration verification modules.

The mock layer is a drop-in replacement for live APIs: flip the {SERVICE}_MOCK flag
(or add credentials) and the live path runs instead — no other code changes.

is_mock_fail derives a pass/fail purely from the input so the same input always yields
the same result and different inputs differ. ~1/fail_rate of inputs "fail", letting a
demo surface rejections without hardcoding specific test values.
"""


def is_mock_fail(value: str, fail_rate: int = 10) -> bool:
    return sum(ord(c) for c in (value or "")) % fail_rate == 0
