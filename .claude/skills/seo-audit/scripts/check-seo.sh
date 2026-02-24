#!/bin/bash
# SEO Quick-Check Script
# Usage: ./check-seo.sh <domain>
# Runs automated checks against a live site and outputs results

DOMAIN="${1:?Usage: check-seo.sh <domain>}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%/}"
URL="https://${DOMAIN}"

echo "🔍 SEO Quick-Check: ${DOMAIN}"
echo "================================"
echo ""

# --- HTTP Response ---
echo "📡 HTTP Response"
STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "${URL}" 2>/dev/null)
echo "  Status: ${STATUS}"

REDIRECT=$(curl -sI -L -o /dev/null -w "%{url_effective}" "${URL}" 2>/dev/null)
if [ "${REDIRECT}" != "${URL}" ] && [ "${REDIRECT}" != "${URL}/" ]; then
    echo "  Redirects to: ${REDIRECT}"
fi

# Check HTTPS
HTTP_STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "http://${DOMAIN}" 2>/dev/null)
HTTPS_STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "${URL}" 2>/dev/null)
if [ "${HTTPS_STATUS}" = "200" ] || [ "${HTTPS_STATUS}" = "301" ] || [ "${HTTPS_STATUS}" = "302" ]; then
    echo "  ✅ HTTPS active"
else
    echo "  ❌ HTTPS issue (status: ${HTTPS_STATUS})"
fi
echo ""

# --- SSL Certificate ---
echo "🔒 SSL Certificate"
CERT_INFO=$(echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null)
if [ -n "${CERT_INFO}" ]; then
    EXPIRY=$(echo "${CERT_INFO}" | grep "notAfter" | cut -d= -f2)
    echo "  Expires: ${EXPIRY}"
    EXPIRY_EPOCH=$(date -d "${EXPIRY}" +%s 2>/dev/null)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    if [ "${DAYS_LEFT}" -gt 30 ]; then
        echo "  ✅ ${DAYS_LEFT} days remaining"
    else
        echo "  ⚠️ Only ${DAYS_LEFT} days remaining!"
    fi
else
    echo "  ❌ Could not check SSL"
fi
echo ""

# --- Response Time ---
echo "⚡ Performance"
TIMING=$(curl -w "Connect: %{time_connect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s | Size: %{size_download} bytes" -o /dev/null -s "${URL}")
echo "  ${TIMING}"
TTFB=$(curl -w "%{time_starttransfer}" -o /dev/null -s "${URL}")
TTFB_MS=$(echo "${TTFB} * 1000" | bc 2>/dev/null || echo "?")
if [ "$(echo "${TTFB} < 0.6" | bc 2>/dev/null)" = "1" ]; then
    echo "  ✅ TTFB: ${TTFB_MS}ms (good)"
else
    echo "  ⚠️ TTFB: ${TTFB_MS}ms (slow, aim for <600ms)"
fi
echo ""

# --- Headers ---
echo "🛡️ Security Headers"
HEADERS=$(curl -sI "${URL}" 2>/dev/null)

check_header() {
    local name="$1"
    local display="$2"
    if echo "${HEADERS}" | grep -qi "^${name}:"; then
        VALUE=$(echo "${HEADERS}" | grep -i "^${name}:" | head -1 | cut -d: -f2- | tr -d '\r' | xargs)
        echo "  ✅ ${display}: ${VALUE}"
    else
        echo "  ❌ Missing: ${display}"
    fi
}

check_header "X-Frame-Options" "X-Frame-Options"
check_header "X-Content-Type-Options" "X-Content-Type-Options"
check_header "Content-Security-Policy" "Content-Security-Policy"
check_header "Strict-Transport-Security" "HSTS"
check_header "Referrer-Policy" "Referrer-Policy"
check_header "Permissions-Policy" "Permissions-Policy"

# Check compression
if echo "${HEADERS}" | grep -qi "content-encoding"; then
    ENCODING=$(echo "${HEADERS}" | grep -i "content-encoding" | head -1 | cut -d: -f2- | tr -d '\r' | xargs)
    echo "  ✅ Compression: ${ENCODING}"
else
    echo "  ⚠️ No compression detected in headers"
fi
echo ""

# --- robots.txt ---
echo "🤖 robots.txt"
ROBOTS_STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "${URL}/robots.txt" 2>/dev/null)
if [ "${ROBOTS_STATUS}" = "200" ]; then
    echo "  ✅ Found (200)"
    ROBOTS=$(curl -s "${URL}/robots.txt" 2>/dev/null)
    if echo "${ROBOTS}" | grep -qi "sitemap"; then
        echo "  ✅ References sitemap"
    else
        echo "  ⚠️ No sitemap reference"
    fi
    if echo "${ROBOTS}" | grep -qi "disallow"; then
        echo "  ✅ Has disallow rules"
    fi
else
    echo "  ❌ Not found (${ROBOTS_STATUS})"
fi
echo ""

# --- sitemap.xml ---
echo "🗺️ sitemap.xml"
SITEMAP_STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "${URL}/sitemap.xml" 2>/dev/null)
if [ "${SITEMAP_STATUS}" = "200" ]; then
    SITEMAP=$(curl -s "${URL}/sitemap.xml" 2>/dev/null)
    URL_COUNT=$(echo "${SITEMAP}" | grep -c "<url>" 2>/dev/null || echo "0")
    echo "  ✅ Found (200) — ${URL_COUNT} URLs"
    if echo "${SITEMAP}" | grep -q "<lastmod>"; then
        echo "  ✅ Has lastmod dates"
    else
        echo "  ⚠️ No lastmod dates"
    fi
else
    echo "  ❌ Not found (${SITEMAP_STATUS})"
fi
echo ""

# --- HTML Quick Parse ---
echo "📄 On-Page SEO"
HTML=$(curl -s "${URL}" 2>/dev/null)

# Title
TITLE=$(echo "${HTML}" | grep -oP '<title[^>]*>\K[^<]+' | head -1)
if [ -n "${TITLE}" ]; then
    TITLE_LEN=${#TITLE}
    if [ "${TITLE_LEN}" -ge 50 ] && [ "${TITLE_LEN}" -le 60 ]; then
        echo "  ✅ Title: \"${TITLE}\" (${TITLE_LEN} chars)"
    elif [ "${TITLE_LEN}" -lt 50 ]; then
        echo "  ⚠️ Title short: \"${TITLE}\" (${TITLE_LEN} chars, aim for 50-60)"
    else
        echo "  ⚠️ Title long: \"${TITLE}\" (${TITLE_LEN} chars, aim for 50-60)"
    fi
else
    echo "  ❌ No title tag found"
fi

# Meta description
META_DESC=$(echo "${HTML}" | grep -oP 'name="description"[^>]*content="\K[^"]+' | head -1)
if [ -z "${META_DESC}" ]; then
    META_DESC=$(echo "${HTML}" | grep -oP 'content="\K[^"]+(?="[^>]*name="description")' | head -1)
fi
if [ -n "${META_DESC}" ]; then
    DESC_LEN=${#META_DESC}
    if [ "${DESC_LEN}" -ge 150 ] && [ "${DESC_LEN}" -le 160 ]; then
        echo "  ✅ Meta description (${DESC_LEN} chars)"
    else
        echo "  ⚠️ Meta description (${DESC_LEN} chars, aim for 150-160)"
    fi
else
    echo "  ❌ No meta description"
fi

# Canonical
if echo "${HTML}" | grep -q 'rel="canonical"'; then
    CANONICAL=$(echo "${HTML}" | grep -oP 'rel="canonical"[^>]*href="\K[^"]+' | head -1)
    if [ -z "${CANONICAL}" ]; then
        CANONICAL=$(echo "${HTML}" | grep -oP 'href="\K[^"]+(?="[^>]*rel="canonical")' | head -1)
    fi
    echo "  ✅ Canonical: ${CANONICAL}"
else
    echo "  ❌ No canonical URL"
fi

# Viewport
if echo "${HTML}" | grep -qi "viewport"; then
    echo "  ✅ Viewport meta tag present"
else
    echo "  ❌ No viewport meta tag (not mobile-friendly)"
fi

# H1 count
H1_COUNT=$(echo "${HTML}" | grep -coP '<h1[\s>]' 2>/dev/null || echo "0")
if [ "${H1_COUNT}" = "1" ]; then
    echo "  ✅ Single H1 tag"
elif [ "${H1_COUNT}" = "0" ]; then
    echo "  ❌ No H1 tag"
else
    echo "  ⚠️ Multiple H1 tags (${H1_COUNT} found, should be 1)"
fi

# Open Graph
OG_CHECKS=("og:title" "og:description" "og:image" "og:url" "og:type")
OG_PASS=0
OG_MISSING=""
for OG in "${OG_CHECKS[@]}"; do
    if echo "${HTML}" | grep -q "property=\"${OG}\""; then
        OG_PASS=$((OG_PASS + 1))
    else
        OG_MISSING="${OG_MISSING} ${OG}"
    fi
done
if [ "${OG_PASS}" = "${#OG_CHECKS[@]}" ]; then
    echo "  ✅ Open Graph: all ${OG_PASS} tags present"
else
    echo "  ⚠️ Open Graph: ${OG_PASS}/${#OG_CHECKS[@]} — missing:${OG_MISSING}"
fi

# JSON-LD
if echo "${HTML}" | grep -q "application/ld+json"; then
    echo "  ✅ JSON-LD structured data present"
else
    echo "  ❌ No JSON-LD structured data"
fi

# Lang attribute
LANG=$(echo "${HTML}" | grep -oP '<html[^>]*lang="\K[^"]+' | head -1)
if [ -n "${LANG}" ]; then
    echo "  ✅ Language: ${LANG}"
else
    echo "  ⚠️ No lang attribute on <html>"
fi

echo ""
echo "================================"
echo "✅ Quick-check complete!"
