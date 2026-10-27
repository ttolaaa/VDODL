FROM docker:cli
RUN apk add --no-cache git su-exec
COPY update.sh /usr/local/bin/vdodl-update
# Strip CRLF in case the checkout was made on Windows without .gitattributes.
RUN sed -i 's/\r$//' /usr/local/bin/vdodl-update && chmod 0755 /usr/local/bin/vdodl-update
ENTRYPOINT ["/usr/local/bin/vdodl-update"]
