#!/bin/bash
# Start NGINX
nginx -g 'daemon off;' &
# Start your application
bun run start
