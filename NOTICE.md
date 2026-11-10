# Notices

omp-antigravity is original code under the MIT license in `LICENSE`. Its design draws on two
MIT-licensed projects that also connect a host agent to the Antigravity CLI over the Agent Client
Protocol:

- [pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider),
  Copyright (c) 2026 pi-gemini-acp-provider contributors. Ideas used here: a loopback HTTP MCP
  server with a per-session bearer token for host tools, tool calls held open until the host
  returns a result, and confirming every model and effort selection against the session state.
- [omp-antigravity-acp-provider](https://github.com/SenCha930511/omp-antigravity-acp-provider),
  Copyright (c) 2026 omp-antigravity-acp-provider contributors. Ideas used here: appending OMP
  instructions through `_meta.antigravity.systemPrompt.append`, the per-message text limit and
  chunked history replay with `OK` acknowledgements, and tying session lifetime to OMP's
  `providerSessionState`.

Both projects are distributed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Antigravity, Gemini, and Google are trademarks of Google LLC. This project is not affiliated with
or endorsed by Google.
