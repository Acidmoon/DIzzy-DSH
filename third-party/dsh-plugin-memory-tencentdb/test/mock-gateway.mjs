import http from 'node:http'
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    console.log(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, service: req.headers['x-tdai-service-id'], body: JSON.parse(body || '{}') }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 0, message: 'ok', data: { accepted_ids: ['m1'], total_count: 1 } }))
  })
})
server.listen(8421, '127.0.0.1', async () => {
  const { MemoryClient } = await import('@tencentdb-agent-memory/memory-sdk-ts-v2/v3')
  const client = new MemoryClient({ endpoint: 'http://127.0.0.1:8421', apiKey: 'local', serviceId: 'default', teamId: 't', agentId: 'a', userId: 'u' })
  const out = await client.addConversation({ session_id: 'sess-1', messages: [{ role: 'user', content: 'hi', timestamp: new Date().toISOString() }] })
  console.log('RESPONSE', JSON.stringify(out))
  server.close()
})
