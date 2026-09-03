const AIRoleplayConnection = (() => {
  async function request(path, { method = 'GET', body, signal } = {}, localAllowed) {
    if (!localAllowed) throw Object.assign(new Error('AI 대화는 Start-English.cmd로 실행한 로컬 앱에서 연결할 수 있습니다. 기본 상황극은 지금 사용할 수 있습니다.'), { code: 'LOCAL_SERVER' });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 30000);
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('로컬 서버가 응답하지 않습니다. Start-English.cmd를 실행해주세요.');
      }
      const value = await response.json();
      if (!response.ok) {
        throw Object.assign(new Error(value.error?.message || 'AI 연결에 실패했습니다.'), { code: value.error?.code || 'NETWORK' });
      }
      return value;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error.name === 'AbortError') {
        throw Object.assign(new Error('답변 대기 시간이 길어 중단했습니다. 자동 재시도하지 않았습니다.'), { code: 'TIMEOUT' });
      }
      if (error instanceof TypeError) {
        throw Object.assign(new Error('연결이 끊겼습니다. 로컬 서버와 인터넷 연결을 확인해주세요.'), { code: 'NETWORK' });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  return { request };
})();
