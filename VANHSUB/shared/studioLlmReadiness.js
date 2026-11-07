/** Configuration checks only. Never returns keys or claims authentication/quota is verified.
 * @param {{provider?:string,apiKey?:string,model?:string,baseUrl?:string}} config
 */
export function studioLlmReadiness(config) {
  const provider = config.provider || '', reasons = [], warnings = [];
  const web = provider === 'chatgpt_web' || provider === 'gemini_web';
  if (!['deepseek', 'openai', 'custom', 'chatgpt_web', 'gemini_web'].includes(provider)) reasons.push('Nhà cung cấp LLM không hợp lệ.');
  if (web) warnings.push('Provider Web chưa được xác minh đăng nhập/generation trong kiểm tra cấu hình này. Không tự đăng nhập hoặc vượt hạn chế của nhà cung cấp.');
  else {
    if (!config.apiKey?.trim() || config.apiKey.startsWith('enc:')) reasons.push(`Thiếu API Key dùng được cho ${provider}. Nhập key qua Cấu hình AI Studio rồi tạo phiên mới.`);
    if (provider === 'custom' && !config.model?.trim()) reasons.push('Custom LLM cần tên model cụ thể.');
    if (provider === 'custom' && !config.baseUrl?.trim()) reasons.push('Custom LLM cần Base URL của endpoint tương thích OpenAI.');
    if (config.baseUrl?.trim()) {
      try {
        const url = new URL(config.baseUrl.trim());
        if (url.username || url.password || url.search || url.hash ||
          !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error();
      } catch { reasons.push('Base URL phải là HTTPS hoặc HTTP loopback, không chứa user/password/query/hash.'); }
    }
    warnings.push('Chỉ kiểm tra cấu hình; chưa xác minh key, quota hoặc quyền gọi model bằng request thật.');
  }
  return { ready: reasons.length === 0, provider, model: config.model?.trim() || (provider === 'deepseek' ? 'deepseek-chat' : provider === 'openai' ? 'gpt-4o' : ''), reasons, warnings, liveVerified: false };
}
