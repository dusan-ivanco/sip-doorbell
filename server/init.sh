#!/bin/bash

dnf -y install epel-release
dnf -y install certbot fail2ban-server
dnf -y install asterisk asterisk-pjsip coturn coturn-utils
