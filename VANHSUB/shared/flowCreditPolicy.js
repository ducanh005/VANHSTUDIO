/** Flow account credits are not Gemini API billing. No network, secrets or inferred login. */
export function flowCreditReadiness(flow, projectId, outputs = 1) {
  const reasons = [];
  if (!['playwright','browser_automation'].includes(flow.engine)) reasons.push('Chọn Google Flow qua giao diện Chrome. RPC cũ chưa được phép chạy lại.');
  if (!projectId || flow.flowCreditProjectId !== projectId || flow.flowCreditConsent !== true) reasons.push('Cần duyệt credit riêng cho project này.');
  if (!Number.isInteger(flow.flowGenerationLimit) || flow.flowGenerationLimit < 1 || flow.flowGenerationLimit > 20 || outputs > flow.flowGenerationLimit) reasons.push('Cần giới hạn 1–20 output cho job, đủ cho số scene đã chọn.');
  if (!Number.isFinite(flow.flowMaxCredits) || flow.flowMaxCredits < 0) reasons.push('Cần ghi mức credit tối đa được duyệt, có thể bằng 0 cho tác vụ miễn credit đã xác minh.');
  if (!flow.flowModelLabel?.trim() || flow.flowModelLabel.length > 120) reasons.push('Cần ghi đúng model đang chọn trên giao diện Flow; app không tự đổi model.');
  if (!['t2v','i2v'].includes(flow.flowVideoMode || 't2v')) reasons.push('Video mode không hợp lệ.');
  if (flow.outputsPerScene !== 1) reasons.push('Chỉ cho phép x1 output mỗi scene; không tự tạo thêm keyframe.');
  return {status:reasons.length?'BLOCKED':'CONFIGURATION_READY',route:'google_flow_credits',liveVerified:false,reasons,balance:null,actualCredits:null,hardCapVerified:false,warnings:['Credit dùng chung tài khoản; số dư/giá phải đọc từ Flow. Không có hard cap phía Google. Nếu giá chưa đọc được chỉ cho phép một generation với xác nhận riêng, không tự retry. Không cần Gemini API key.']};
}

export function assertFlowQuote(approval, observed) {
  if (observed.model !== approval.model || observed.outputs !== 1 || observed.mode !== approval.mode) throw new Error('FLOW_SETTINGS_UNVERIFIED: model/mode/x1 phải khớp cấu hình đã duyệt trên Flow.');
  if (observed.blocked) throw new Error('FLOW_SECURITY_RESTRICTION: dừng, không retry hoặc đổi route.');
  if (observed.hasReferences && approval.task !== 'i2v') throw new Error('FLOW_UNEXPECTED_REFERENCE: không gửi ảnh tham chiếu ngoài tác vụ đã duyệt.');
  if (observed.credits === null) {
    if (!approval.allowUnknownCost || approval.limit !== 1 || approval.remainingCredits <= 0) throw new Error('FLOW_CREDIT_CONFIRMATION_REQUIRED: chưa đọc được giá; chỉ một output với xác nhận riêng và budget dương.');
  } else if (!Number.isFinite(observed.credits) || observed.credits < 0 || observed.credits > approval.remainingCredits) throw new Error('FLOW_CREDIT_LIMIT: giá trên UI vượt credit được duyệt còn lại.');
  if (observed.balance !== null && observed.credits !== null && observed.balance < observed.credits) throw new Error('FLOW_INSUFFICIENT_CREDITS');
}
