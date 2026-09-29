#!/bin/bash
# Same installer as deploy/install.sh. Kept so an already cloned checkout can be installed with:
#   sudo bash deploy/install-pi.sh
exec bash "$(cd "$(dirname "$0")" && pwd)/install.sh"
