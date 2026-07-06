"""
Supplier/vendor utility helpers for NPI Watch.
"""

SUPPLIER_TYPE_MAP = {
    "dme supplier":           "DME",
    "dme - contact lens":     "DME",
    "dme - oxygen":           "DME",
    "dme - prosthetics":      "DME",
    "dme - nursing facility": "DME",
    "home health agency":     "HOME_HEALTH",
    "home health clinic":     "HOME_HEALTH",
    "community hospice":      "HOSPICE",
    "hospice care":           "HOSPICE",
}


def normalize_vendor_type(supplier_type: str) -> str:
    """
    Maps supplier_profiles.supplier_type raw string to the normalized
    vendor_type used across NPI Watch (DME, HOME_HEALTH, HOSPICE).
    Returns UNKNOWN if no match — never raises.
    """
    if not supplier_type:
        return "UNKNOWN"
    return SUPPLIER_TYPE_MAP.get(supplier_type.lower().strip(), "UNKNOWN")
