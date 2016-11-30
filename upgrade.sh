#!/usr/bin/env bash
# set -o pipefail
set -o errexit
set -o nounset
# set -o xtrace

version=$(node -e 'console.log(require("./package.json").version)')

for dir in ~/code/lanyon/example ~/code/transloadify ~/code/tus.io ~/code/frey-website ~/code/bash3boilerplate; do
  pushd ${dir}
    npm unlink lanyon || true
    yarn add lanyon@${version}
    git add package.json yarn.lock
    git commit -m "Upgrade Lanyon to v${version}" || true
    git pull && git push
  popd
done