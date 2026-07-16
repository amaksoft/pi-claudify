const MAGIC_WORD_PATTERN =
  /\b(?:clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))\b[:\s]+((?:[A-Z][A-Z0-9]*-\d+)(?:\s*(?:,|and|&)\s*[A-Z][A-Z0-9]*-\d+)*)/gi

const IDENTIFIER_PATTERN = /[A-Z][A-Z0-9]*-\d+/g

export function extractClosingReferences(messages) {
  const identifiers = new Set()
  for (const message of messages) {
    for (const match of message.matchAll(MAGIC_WORD_PATTERN)) {
      for (const identifier of match[1].toUpperCase().match(IDENTIFIER_PATTERN) ?? []) {
        identifiers.add(identifier)
      }
    }
  }
  return [...identifiers].sort()
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. Add it as a Forgejo Actions repository secret or variable.`)
  }
  return value
}

async function planeRequest(config, path, init = {}) {
  const response = await fetch(`${config.baseUrl}/api/v1/workspaces/${config.workspace}/projects/${config.projectId}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      ...init.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Plane API returned HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

// Plane's list endpoint ignores a `sequence_id` filter, and its detail endpoint
// only takes the work item UUID, so map CLFY-N -> uuid by paging the (tiny,
// field-limited) issue list once per run.
async function loadSequenceIndex(config) {
  const index = new Map()
  let query = '/issues/?fields=id,sequence_id,name,state&per_page=100'
  for (;;) {
    const page = await planeRequest(config, query)
    for (const issue of page.results) {
      index.set(issue.sequence_id, issue)
    }
    if (!page.next_page_results) return index
    query = `/issues/?fields=id,sequence_id,name,state&per_page=100&cursor=${page.next_cursor}`
  }
}

async function main() {
  const config = {
    apiKey: requireEnv('PLANE_API_KEY'),
    baseUrl: requireEnv('PLANE_BASE_URL').replace(/\/$/, ''),
    workspace: requireEnv('PLANE_WORKSPACE_SLUG'),
    projectId: requireEnv('PLANE_PROJECT_ID'),
  }
  const prefix = process.env.PLANE_PROJECT_IDENTIFIER ?? 'CLFY'

  const identifiers = extractClosingReferences([process.env.PR_TITLE ?? '', process.env.PR_BODY ?? ''])
  const prLabel = process.env.PR_NUMBER ? `PR #${process.env.PR_NUMBER}` : 'the pull request'

  if (identifiers.length === 0) {
    console.log(`No closing issue references found in ${prLabel} title/body.`)
    return
  }
  console.log(`Found closing references in ${prLabel}: ${identifiers.join(', ')}`)

  const { results: states } = await planeRequest(config, '/states/')
  const closed = new Set(states.filter((s) => s.group === 'completed' || s.group === 'cancelled').map((s) => s.id))
  const done = states.find((s) => s.group === 'completed' && s.name === 'Done')
    ?? states.find((s) => s.group === 'completed')
  if (!done) throw new Error('Plane project has no completed workflow state')

  const index = await loadSequenceIndex(config)

  for (const identifier of identifiers) {
    const [issuePrefix, sequence] = identifier.split('-')
    if (issuePrefix !== prefix) {
      console.log(`::warning::${identifier} is not a ${prefix} issue; skipping.`)
      continue
    }
    const issue = index.get(Number(sequence))
    if (!issue) {
      console.log(`::warning::Could not find Plane work item ${identifier}.`)
      continue
    }
    if (closed.has(issue.state)) {
      console.log(`${identifier} already closed; skipping.`)
      continue
    }
    await planeRequest(config, `/issues/${issue.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ state: done.id }),
    })
    console.log(`${identifier} (${issue.name}) -> ${done.name}`)
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
