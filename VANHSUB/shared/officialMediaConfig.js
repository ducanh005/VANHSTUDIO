export const OFFICIAL_IMAGE_MODELS = ['gemini-3.1-flash-image'];
export const OFFICIAL_VIDEO_MODELS = ['gemini-omni-1.1-flash'];

/** Conservative application capabilities, not a claim that every provider feature is implemented. */
export function officialCapabilityIssue(req) {
  const task = req.task || (req.mediaType === 'image' ? 't2i' : req.referenceImage ? 'i2v' : 't2v');
  if (!['t2i', 't2v', 'i2v'].includes(task) || req.lastFrame || req.fps !== undefined || req.durationSeconds !== undefined) return 'UNSUPPORTED: first/last-frame, FPS và duration chính xác chưa được triển khai cho Interactions.';
  if (!['16:9','9:16'].includes(req.aspectRatio)) return 'UNSUPPORTED: chỉ hỗ trợ 16:9 hoặc 9:16.';
  if (task === 't2i' ? req.mediaType !== 'image' || !OFFICIAL_IMAGE_MODELS.includes(req.model) || !!req.referenceImage
    : req.mediaType !== 'video' || !OFFICIAL_VIDEO_MODELS.includes(req.model) || (req.resolution || '720p') !== '720p') return 'UNSUPPORTED: model hoặc capability media không phù hợp.';
  if (task === 'i2v' && !req.referenceImage || task === 't2v' && req.referenceImage) return 'BLOCKED: I2V cần keyframe riêng của scene; T2V không gửi ảnh tham chiếu.';
  if (task !== 't2i' && req.expectedDurationSec !== undefined && (!Number.isFinite(req.expectedDurationSec) || req.expectedDurationSec <= 0 || req.expectedDurationSec > 10 || req.expectedDurationSec < 3 && req.allowTimelineTrim !== true)) return 'UNSUPPORTED: Omni xuất clip 3–10 giây. Scene dưới 3 giây cần cho phép trim rõ ràng; scene trên 10 giây cần chia lại, không tự generation bù.';
  return null;
}

/** Returns no secret. CONFIGURATION_READY never means authentication/quota was tested. */
export function studioMediaReadiness(flow, projectId) {
  const route = flow.engine || 'rpc', reasons = [];
  if (route === 'manual') return {status:'BLOCKED',route,liveVerified:false,reasons:['Chế độ nhập thủ công: không gửi generation; nhập media vào từng scene.']};
  if (route !== 'official_api') return {status:'BLOCKED',route:'legacy_flow',liveVerified:false,reasons:['Legacy Flow chưa được nghiệm thu lại; không tự chuyển route hoặc retry unusual activity.']};
  const unsupported = !OFFICIAL_IMAGE_MODELS.includes(flow.officialImageModel) || !OFFICIAL_VIDEO_MODELS.includes(flow.officialVideoModel) || !['16:9','9:16'].includes(flow.aspectRatio) || !['t2v','i2v'].includes(flow.officialVideoMode);
  if (unsupported) reasons.push('Model, tỷ lệ hoặc video mode chưa được hỗ trợ; cần lưu cấu hình official rõ ràng.');
  if (!flow.apiKey?.trim() || flow.apiKey.startsWith('enc:')) reasons.push('Thiếu API key official dùng được.');
  if (flow.officialConsent !== true) reasons.push('Chưa cho phép sử dụng API có thể tính phí.');
  if (flow.officialCostAcknowledged !== true || typeof flow.officialBudgetNote !== 'string' || !flow.officialBudgetNote.trim() || flow.officialBudgetNote.length > 200) reasons.push('Cần ghi phạm vi chi phí được duyệt và xác nhận chưa có giới hạn tiền tự động; số request không phải ngân sách USD.');
  if (!projectId || flow.officialConsentProjectId !== projectId) reasons.push('Quyền sử dụng API phải được xác nhận riêng cho project đang chọn.');
  if (!Number.isInteger(flow.officialRequestLimit) || flow.officialRequestLimit < 1 || flow.officialRequestLimit > 20) reasons.push('Cần giới hạn 1–20 request cho mỗi episode; mặc định không cho gọi.');
  return {status:unsupported?'UNSUPPORTED':reasons.length?'BLOCKED':'CONFIGURATION_READY',route,liveVerified:false,reasons,warnings:['Chưa xác minh key/quota Live. Video 720p, 3–10 giây, 24 FPS; timeline render chuyển FPS riêng. Không hứa first-frame chính xác.', 'Giới hạn request không phải hard cap USD. Giá tham khảo output video 720p khoảng $0.10/giây, chưa gồm input và output khác; không xác định tổng phí tối đa.']};
}
