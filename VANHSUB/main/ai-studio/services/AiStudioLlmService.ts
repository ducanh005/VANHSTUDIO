import { parseScriptEvaluation, resolveEvaluationConfig, SCRIPT_REVIEW_CRITERIA } from '../scriptEvaluation';
import { assertUsableScript } from '../../../shared/aiStudioScript';
import { selectLlmProvider } from '../llmProviderConfig';
import { studioLlmReadiness } from '../../../shared/studioLlmReadiness';
import { redactLogText } from '../../security/logRedaction';
import { parseRefinedScript } from '../scriptRefinement';
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import crypto from 'crypto';
import type {
  AiStudioLlmConfig,
  ScriptBeatLine,
  StoryboardScene,
  AiStudioFlowEngineConfig,
  IdeaBlueprint,
  SeoMetadata,
  ScriptQualityAuditResult,
  ChannelProfileConfig,
  ScriptEvaluation,
} from '../types';
import type { PipelineTimingData } from '../types/storage';

/**
 * AiStudioLlmService: LLM coordination service for AI Video Studio
 *
 * Implements:
 * - Stage 1: Idea Blueprint Analysis
 * - Stage 2: Structured Dialogue Script Generation (with jsonrepair & offline fallback)
 * - Stage 5: Storyboard Scene Visual Prompts (English cinematic prompt formatting)
 * - Stage 8: Viral SEO Metadata (Title, Description, Hashtags, Thumbnail Prompt)
 * - Script Quality Audit (Audience retention evaluation 0-100)
 */
export class AiStudioLlmService {
  private static instance: AiStudioLlmService | null = null;

  public static getInstance(): AiStudioLlmService {
    if (!AiStudioLlmService.instance) {
      AiStudioLlmService.instance = new AiStudioLlmService();
    }
    return AiStudioLlmService.instance;
  }

  // ==========================================================================
  // Client Factory
  // ==========================================================================
  private createClient(config: AiStudioLlmConfig): { client: OpenAI; model: string } | null {
    const readiness = studioLlmReadiness(config);
    if (!readiness.ready) throw new Error(readiness.reasons.join(' '));
    if (config.provider === 'chatgpt_web' || config.provider === 'gemini_web') return null;
    const rawApiKey = (config.apiKey || '').trim();
    if (!rawApiKey) return null;

    let baseURL = (config.baseUrl || '').trim();
    if (!baseURL) {
      if (config.provider === 'deepseek') {
        baseURL = 'https://api.deepseek.com/v1';
      } else {
        baseURL = 'https://api.openai.com/v1';
      }
    }

    const client = new OpenAI({
      apiKey: rawApiKey,
      baseURL,
      timeout: 45_000,
      maxRetries: 0,
    });

    const model = readiness.model;
    return { client, model };
  }

  public resolveChannelLlmConfig(config: AiStudioLlmConfig, profile?: Partial<ChannelProfileConfig>): AiStudioLlmConfig {
    return selectLlmProvider(config, profile?.aiProvider);
  }

  // ==========================================================================
  // Split Existing Script to Beat Lines
  // ==========================================================================
  public splitScriptToBeatLines(rawScript: string): ScriptBeatLine[] {
    if (!rawScript || typeof rawScript !== 'string') return [];

    const rawChunks = rawScript
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const sentences: string[] = [];

    for (const chunk of rawChunks) {
      // Split on sentence boundaries (. ! ? …) when followed by whitespace and a capital/number
      const parts = chunk
        .split(/(?<=[.!?…])\s+(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ0-9"“'\[])/u)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length > 0) {
        sentences.push(...parts);
      } else if (chunk.length > 0) {
        sentences.push(chunk);
      }
    }

    const filtered = sentences.filter((s) => s.length >= 2);

    return filtered.map((text, idx) => {
      const cleanText = text.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
      // Clamped within Veo limits [2.0s, 8.0s]
      const rawSec = Math.round((wordCount / 3.2) * 10) / 10;
      const estimatedDurationSec = Math.min(8.0, Math.max(2.0, rawSec));

      const beatType: ScriptBeatLine['beatType'] =
        idx === 0
          ? 'hook'
          : idx === 1
          ? 'intro'
          : idx === filtered.length - 1
          ? 'outro'
          : idx === filtered.length - 2
          ? 'climax'
          : 'body';

      const isDynamic = beatType === 'hook' || beatType === 'climax' || /chạy|nhảy|bay|lao|đuổi|chiến|nổ/i.test(cleanText);

      return {
        id: `line-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
        index: idx + 1,
        text: cleanText,
        voiceDirection: idx === 0 ? 'Hồi hộp, lôi cuốn' : idx === filtered.length - 1 ? 'Kêu gọi rõ ràng, lắng đọng' : undefined,
        visualAction: cleanText,
        cameraAngle: idx === 0 ? 'close_up' : idx === 1 ? 'wide_establishing' : 'medium_shot',
        cameraMovement: isDynamic ? 'dolly_in' : 'pan_left_to_right',
        suggestedMediaType: isDynamic ? 'video' : 'image',
        estimatedDurationSec,
        beatType,
      };
    });
  }

  // ==========================================================================
  // Parse Blueprint JSON Helper
  // ==========================================================================
  public parseBlueprintJson(
    rawText: string,
    topic: string,
    aspectRatio: '16:9' | '9:16' = '16:9',
    channelProfile?: Partial<ChannelProfileConfig>
  ): IdeaBlueprint {
    // 1. Loại bỏ các ký tự template placeholder như {{CHANNEL_NAME}}
    // để tránh làm sai lệch bộ bắt dấu ngoặc nhọn hoặc lỗi cú pháp JSON
    let sanitizedText = (rawText || '')
      .replace(/\{\{\s*CHANNEL_NAME\s*\}\}/gi, channelProfile?.projectName || channelProfile?.channelNiche || 'Kênh')
      .replace(/\{\{\s*SOURCE_MATERIAL\s*\}\}/gi, topic || 'Chủ đề')
      .replace(/\{\{\s*[^}]*\s*\}\}/g, ''); // Loại bỏ các cụm {{...}} tự do khác

    // 2. Tìm khối markdown ```json ... ``` hoặc ``` ... ``` trước
    let candidate = '';
    const codeBlockMatch = sanitizedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1].includes('{')) {
      candidate = codeBlockMatch[1].trim();
    }

    // 3. Nếu không có code block hoặc candidate không bắt đầu bằng '{',
    // tìm vị trí chứa từ khóa JSON đặc trưng ("title", "hookConcept", "outline")
    // và dò ngược lại dấu '{' mở khối chính xác
    if (!candidate || !candidate.startsWith('{')) {
      const keyIndex = sanitizedText.search(/"(?:title|hookConcept|narrativeAngle|outline|keyBeats)"/i);
      if (keyIndex !== -1) {
        const startBrace = sanitizedText.lastIndexOf('{', keyIndex);
        if (startBrace !== -1) {
          const sub = sanitizedText.slice(startBrace);
          const endBrace = sub.lastIndexOf('}');
          if (endBrace !== -1) {
            candidate = sub.slice(0, endBrace + 1).trim();
          }
        }
      }
    }

    // 4. Dự phòng: tìm khối ngoặc nhọn ngoài cùng
    if (!candidate) {
      const generalMatch = sanitizedText.match(/\{[\s\S]*\}/);
      if (generalMatch) {
        candidate = generalMatch[0].trim();
      }
    }

    let parsed: any = {};
    try {
      if (candidate) {
        const repaired = jsonrepair(candidate);
        parsed = JSON.parse(repaired);
      } else {
        throw new Error('Không tìm thấy khối JSON trong văn bản phản hồi');
      }
    } catch (parseErr) {
      // Recover only fields actually supplied by the provider; never invent an outline.

      const extractField = (pattern: RegExp): string => {
        const match = sanitizedText.match(pattern);
        return match ? match[1].trim() : '';
      };

      const title =
        extractField(/"title"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Tiêu đề|Title)[:\-]\s*(.+)/i) ||
        topic;

      const hookConcept =
        extractField(/"hookConcept"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Hook|Câu mở đầu)[:\-]\s*(.+)/i);

      const narrativeAngle =
        extractField(/"narrativeAngle"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Góc nhìn|Angle)[:\-]\s*(.+)/i);

      const thumbnailConcept =
        extractField(/"thumbnailConcept"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Thumbnail|Ảnh bìa)[:\-]\s*(.+)/i);

      const thumbnailPrompt =
        extractField(/"thumbnailPrompt"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Thumbnail prompt|Prompt ảnh)[:\-]\s*(.+)/i);

      const outlineMatches = sanitizedText
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            /^\[?\d+[\.:\-\]]/i.test(l) ||
            /^Phân đoạn\s*\d+/i.test(l) ||
            /^Beat\s*\d+/i.test(l) ||
            /^[•\-\*]\s+/i.test(l)
        );

      parsed = {
        title: title || topic,
        hookConcept,
        narrativeAngle,
        outline: outlineMatches.length >= 2 ? outlineMatches : undefined,
        thumbnailConcept,
        thumbnailPrompt,
      };
    }

    // Tính toán thời lượng mục tiêu từ Cấu hình kênh
    let targetDurationSec = aspectRatio === '9:16' ? 45 : 240;
    if (channelProfile) {
      if (aspectRatio === '9:16') {
        if (channelProfile.targetShortDuration === '30_60_sec') targetDurationSec = 45;
        else if (channelProfile.targetShortDuration === '60_90_sec') targetDurationSec = 75;
        else if (channelProfile.targetShortDuration === '90_120_sec') targetDurationSec = 105;
        else if (channelProfile.targetShortDuration === '120_180_sec') targetDurationSec = 150;
      } else {
        if (channelProfile.targetLongDuration === '1_3_min') targetDurationSec = 120;
        else if (channelProfile.targetLongDuration === '3_5_min') targetDurationSec = 240;
        else if (channelProfile.targetLongDuration === '5_8_min') targetDurationSec = 390;
        else if (channelProfile.targetLongDuration === '8_12_min') targetDurationSec = 600;
        else if (channelProfile.targetLongDuration === '12_18_min') targetDurationSec = 900;
        else if (channelProfile.targetLongDuration === '18_28_min') targetDurationSec = 1400;
      }
    }

    const estimatedDurationSec =
      Number(parsed.estimatedDurationSec) > 0
        ? Number(parsed.estimatedDurationSec)
        : targetDurationSec;

    let outlineArray: string[] = Array.isArray(parsed.outline) && parsed.outline.length > 0
      ? parsed.outline
      : Array.isArray(parsed.keyBeats) && parsed.keyBeats.length > 0
      ? parsed.keyBeats
      : [];

    // Fallback 1: Nếu JSON trả về outline quá ngắn (< 4 phân đoạn), quét lại raw text xem có danh sách phân đoạn đầy đủ hơn
    if (outlineArray.length < 4) {
      const textBeats = sanitizedText
        .split('\n')
        .map((l) => l.trim().replace(/^[-*•]\s*/, ''))
        .filter(
          (l) =>
            (/^\[?\d+[\.:\-\]]/i.test(l) ||
              /^Phân đoạn\s*\d+/i.test(l) ||
              /^Beat\s*\d+/i.test(l) ||
              /\[\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\]/i.test(l)) &&
            l.length > 15
        );
      if (textBeats.length >= 4) {
        outlineArray = textBeats;
      }
    }

    if (outlineArray.length < 3 || outlineArray.some(beat => typeof beat !== 'string' || !/[\p{L}\p{N}]/u.test(beat)) ||
        ['title','hookConcept','narrativeAngle'].some(key => typeof parsed[key] !== 'string' || !parsed[key].trim())) {
      throw new Error('LLM trả blueprint sai schema: cần title, hookConcept, narrativeAngle và ít nhất 3 ý có nội dung. Không dùng dàn ý mẫu.');
    }

    // Thiết lập thumbnailPrompt dự phòng chuẩn theo Nhân vật và Model của Kênh
    const hostName =
      channelProfile?.hostName?.trim() ||
      channelProfile?.channelCharacters?.[0]?.name?.trim();
    const hostDesc =
      channelProfile?.hostDescription?.trim() ||
      channelProfile?.channelCharacters?.[0]?.descriptionEn?.trim();
    const imageModel = channelProfile?.imageModel?.trim() || 'Nano Banana 2';

    let defaultThumbnailPrompt = `Cinematic high resolution photography for video thumbnail of ${parsed.title || topic}, dramatic lighting, 8k, photorealistic, optimized for ${imageModel}`;
    if (hostName && hostDesc) {
      defaultThumbnailPrompt = `Cinematic high resolution photography featuring character ${hostName} (${hostDesc}), dramatic lighting, 8k, photorealistic, optimized for ${imageModel}`;
    }

    let finalThumbnailPrompt = (parsed.thumbnailPrompt || '').trim() || defaultThumbnailPrompt;
    if (hostName && hostDesc) {
      const lowerPrompt = finalThumbnailPrompt.toLowerCase();
      const lowerName = hostName.toLowerCase();
      const lowerDesc = hostDesc.toLowerCase().slice(0, Math.min(25, hostDesc.length));
      if (!lowerPrompt.includes(lowerDesc) && !lowerPrompt.includes(lowerName)) {
        finalThumbnailPrompt = `Cinematic YouTube thumbnail of ${parsed.title || topic}, featuring character ${hostName} (${hostDesc}), dramatic lighting, high CTR composition, 8k, photorealistic, optimized for ${imageModel}. ${finalThumbnailPrompt}`;
      }
    }

    let finalThumbnailConcept = (parsed.thumbnailConcept || '').trim() || `Ý tưởng thumbnail ấn tượng về ${parsed.title || topic}`;
    if (hostName && !finalThumbnailConcept.toLowerCase().includes(hostName.toLowerCase())) {
      finalThumbnailConcept = `${finalThumbnailConcept} (Nhân vật đại diện ${hostName}: ${hostDesc || 'tâm điểm'})`;
    }

    return {
      topic,
      title: parsed.title || topic,
      aspectRatio,
      targetAudience: parsed.targetAudience || 'Khán giả đại chúng yêu thích video thông tin nhanh',
      narrativeAngle: parsed.narrativeAngle || 'Góc tiếp cận độc đáo, đột phá của kênh',
      hookConcept: parsed.hookConcept || `Bạn có tin vào sự thật đằng sau ${topic}?`,
      pacing: parsed.pacing || (aspectRatio === '9:16' ? 'fast' : 'moderate'),
      estimatedDurationSec,
      keyBeats: outlineArray,
      outline: outlineArray,
      thumbnailConcept: finalThumbnailConcept,
      thumbnailPrompt: finalThumbnailPrompt,
      rawSummary:
        parsed.rawSummary ||
        `Chiến lược sản xuất video "${parsed.title || topic}" với tỷ lệ ${aspectRatio}, thời lượng dự kiến ${Math.round((estimatedDurationSec / 60) * 10) / 10} phút.`,
    };
  }

  // ==========================================================================
  // Stage 1: Idea Blueprint Analysis
  // ==========================================================================
  public async analyzeIdeaBlueprint(
    topic: string,
    config: AiStudioLlmConfig,
    aspectRatio: '16:9' | '9:16' = '16:9',
    onProgress?: (msg: string) => void,
    channelProfile?: Partial<ChannelProfileConfig>
  ): Promise<IdeaBlueprint> {
    const projectName = channelProfile?.projectName?.trim() || '';
    const channelNiche = channelProfile?.channelNiche?.trim() || '';
    const channelDescription = channelProfile?.channelDescription?.trim() || '';
    const channelOrientation = channelProfile?.channelOrientation?.trim() || '';
    const channelHook = channelProfile?.channelHook?.trim() || '';
    const masterPrompt = channelProfile?.masterPrompt?.trim() || '';
    const imageModel = channelProfile?.imageModel?.trim() || 'Nano Banana 2';
    const videoModel = channelProfile?.videoModel?.trim() || 'Omni 1.1 Flash';
    const visualArtStylePreset = channelProfile?.visualArtStylePreset || 'cinematic';
    const projectBackgroundPrompt = channelProfile?.projectBackgroundPrompt?.trim() || '';

    const hostName =
      channelProfile?.hostName?.trim() ||
      channelProfile?.channelCharacters?.[0]?.name?.trim() ||
      '';
    const hostDescription =
      channelProfile?.hostDescription?.trim() ||
      channelProfile?.channelCharacters?.[0]?.descriptionEn?.trim() ||
      '';
    const characterRole = channelProfile?.characterRole?.trim() || 'Nhân vật dẫn dắt / tâm điểm';

    const effectiveProvider =
      channelProfile?.aiProvider && channelProfile.aiProvider !== 'default'
        ? channelProfile.aiProvider
        : config?.provider || 'deepseek';
    const effectiveConfig = this.resolveChannelLlmConfig(config, channelProfile);

    // Tính toán mục tiêu thời lượng và số lượng phân đoạn dàn ý
    let durationLabel = '3 - 5 phút';
    let targetSec = 240;
    let minBeats = 6;
    let maxBeats = 8;

    if (aspectRatio === '9:16') {
      const shortDur = channelProfile?.targetShortDuration || '30_60_sec';
      if (shortDur === '30_60_sec') {
        durationLabel = '30 - 60 giây (~45 giây)';
        targetSec = 45;
        minBeats = 4;
        maxBeats = 6;
      } else if (shortDur === '60_90_sec') {
        durationLabel = '60 - 90 giây (~75 giây)';
        targetSec = 75;
        minBeats = 6;
        maxBeats = 8;
      } else if (shortDur === '90_120_sec') {
        durationLabel = '90 - 120 giây (~105 giây)';
        targetSec = 105;
        minBeats = 8;
        maxBeats = 10;
      } else if (shortDur === '120_180_sec') {
        durationLabel = '2 - 3 phút (~150 giây)';
        targetSec = 150;
        minBeats = 10;
        maxBeats = 12;
      }
    } else {
      const longDur = channelProfile?.targetLongDuration || '3_5_min';
      if (longDur === '20_30_sec') {
        durationLabel = '20 - 30 giây (~55 - 75 từ, đúng 3 câu phân cảnh)';
        targetSec = 25;
        minBeats = 3;
        maxBeats = 3;
      } else if (longDur === '1_3_min') {
        durationLabel = '1 - 3 phút (~250 - 500 từ)';
        targetSec = 120;
        minBeats = 4;
        maxBeats = 6;
      } else if (longDur === '3_5_min') {
        durationLabel = '3 - 5 phút (~600 - 900 từ)';
        targetSec = 240;
        minBeats = 6;
        maxBeats = 8;
      } else if (longDur === '5_8_min') {
        durationLabel = '5 - 8 phút (~1000 - 1500 từ)';
        targetSec = 390;
        minBeats = 8;
        maxBeats = 10;
      } else if (longDur === '8_12_min') {
        durationLabel = '8 - 12 phút (~1500 - 2200 từ)';
        targetSec = 600;
        minBeats = 10;
        maxBeats = 14;
      } else if (longDur === '12_18_min') {
        durationLabel = '12 - 18 phút (~2200 - 3200 từ)';
        targetSec = 900;
        minBeats = 14;
        maxBeats = 18;
      } else if (longDur === '18_28_min') {
        durationLabel = '18 - 28 phút (~3200 - 5000 từ)';
        targetSec = 1400;
        minBeats = 18;
        maxBeats = 24;
      }
    }

    const channelContextParts: string[] = [];

    if (projectName || channelNiche) {
      channelContextParts.push(
        `=== 1. ĐỊNH DANH DỰ ÁN & KÊNH ===\n- Tên Dự Án/Kênh: "${projectName || 'Chưa đặt tên'}"\n- Ngách nội dung (Niche): "${channelNiche || 'Nội dung đại chúng'}"\n- Định hướng phong cách: "${channelOrientation || 'Kịch tính, sâu sắc, cuốn hút'}"`
      );
    }

    if (channelDescription) {
      channelContextParts.push(
        `=== 1B. BẢN SẮC & MÔ TẢ KÊNH ===\n"${channelDescription}"`
      );
    }

    if (channelProfile?.seriesType) {
      const seriesTypeMap: Record<string, string> = {
        standalone: 'Các tập độc lập (chủ đề mới hoàn toàn mỗi tập, không phụ thuộc tập trước)',
        serialized: 'Chuỗi tập liền mạch (theo tiến trình thời gian/cốt truyện tiếp diễn)',
        anthology: 'Tuyển tập chuyên đề (cùng một vũ trụ/ngách nhưng nhân vật/vụ án khác nhau)',
      };
      channelContextParts.push(
        `- Kiểu chuỗi tập: ${seriesTypeMap[channelProfile.seriesType] || channelProfile.seriesType}`
      );
    }

    channelContextParts.push(
      `=== 2. THỜI LƯỢNG MỤC TIÊU & QUY CHUẨN DÀN Ý ===\n- Định dạng: ${aspectRatio === '9:16' ? 'Video Ngắn dọc (9:16 Shorts/TikTok/Reels)' : 'Video Dài ngang (16:9 YouTube)'}\n- Thời lượng mục tiêu: ${durationLabel} (ước tính ~${targetSec} giây)\n- Yêu cầu số lượng phân đoạn trong dàn ý: BẮT BUỘC có ĐỦ từ ${minBeats} đến ${maxBeats} phân đoạn cụ thể để bao quát toàn bộ thời lượng yêu cầu.`
    );

    if (channelHook) {
      channelContextParts.push(
        `- Hook thương hiệu của kênh: "${channelHook}" (hãy lồng ghép hoặc sáng tạo dựa trên hook này).`
      );
    }

    if (masterPrompt && masterPrompt.trim().length >= 40) {
      const sanitizedMasterPrompt = masterPrompt
        .replace(/\{\{\s*CHANNEL_NAME\s*\}\}/gi, projectName || channelNiche || 'Kênh Vanhsub Studio')
        .replace(/\{\{\s*SOURCE_MATERIAL\s*\}\}/gi, topic || 'Chủ đề video')
        .replace(/\{\{\s*[^}]*\s*\}\}/g, '');
      channelContextParts.push(
        `=== 3. MASTER PROMPT & NGUYÊN TẮC KÊNH ===\nKịch bản và dàn ý phải tuyệt đối tuân thủ tinh thần và phong cách chỉ đạo từ Master Prompt của kênh:\n"""\n${sanitizedMasterPrompt.slice(0, 3500)}\n"""`
      );
    }

    channelContextParts.push(
      `=== 4. PHONG CÁCH NGHỆ THUẬT & MODEL HÌNH ẢNH / VIDEO ===\n- Preset phong cách nghệ thuật: "${visualArtStylePreset}"\n- Model hình ảnh: "${imageModel}"\n- Model video: "${videoModel}"${projectBackgroundPrompt ? `\n- Bối cảnh / Vũ trụ thị giác chung: "${projectBackgroundPrompt}"` : ''}\n- Prompt tạo ảnh bìa (thumbnailPrompt) PHẢI được viết bằng tiếng Anh chi tiết, tối ưu hóa các từ khóa ánh sáng cinematic, framing, camera angle, 8k photorealistic phù hợp với phong cách [${visualArtStylePreset}] và model [${imageModel}].`
    );

    if (hostName || hostDescription) {
      channelContextParts.push(
        `=== 5. KHÓA NHÂN VẬT ĐẠI DIỆN (CHARACTER CONSISTENCY) ===\n- Tên nhân vật: ${hostName || 'Nhân vật chính'}\n- Mô tả ngoại hình & phong cách: "${hostDescription}"\n- Vai trò: "${characterRole}"\n=> BẮT BUỘC: Cả "thumbnailConcept" (tiếng Việt) và "thumbnailPrompt" (tiếng Anh) PHẢI đặt nhân vật ${hostName} làm tâm điểm thị giác với đúng đặc điểm diện mạo, trang phục và phong cách vẽ/chụp đã thiết lập để đảm bảo tính nhất quán (Character Consistency)!`
      );
    }

    const channelContextText = channelContextParts.join('\n\n');

    const buildSampleOutline = (count: number, totalSec: number): string[] => {
      const step = Math.max(8, Math.round(totalSec / count));
      const formatTime = (seconds: number): string => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      };
      const sampleThemes = [
        'Mở đầu gây sốc / Bối cảnh giật gân cuốn hút',
        'Khám phá manh mối / Giới thiệu mâu thuẫn & sự kiện then chốt',
        'Diễn biến leo thang / Bí mật ẩn giấu dần hé lộ',
        'Bước ngoặt bất ngờ / Xung đột chạm đỉnh cao trào',
        'Đỉnh điểm kịch tính / Đối đầu gay cấn & giải mã sự thật',
        'Hậu quả / Bài học đắt giá & Đúc kết chiêm nghiệm sâu sắc',
        'Thực tế hiện tại / Tác động lâu dài đến người trong cuộc',
        'Góc nhìn mở rộng / Những góc khuất chưa từng được kể',
        'Tổng kết toàn diện & Kêu gọi hành động (CTA) đăng ký theo dõi',
        'Lời cảnh tỉnh tương lai & Lời chào chốt hạ ấn tượng',
      ];
      const beats: string[] = [];
      for (let i = 0; i < count; i++) {
        const startSec = i * step;
        const endSec = i === count - 1 ? totalSec : Math.min(totalSec, (i + 1) * step);
        const theme = sampleThemes[i % sampleThemes.length] || `Phát triển câu chuyện phân đoạn ${i + 1}`;
        beats.push(`Phân đoạn ${i + 1} [${formatTime(startSec)} - ${formatTime(endSec)}]: ${theme}...`);
      }
      return beats;
    };

    const sampleOutlineBeats = buildSampleOutline(minBeats, targetSec);
    const sampleOutlineJson = JSON.stringify(sampleOutlineBeats, null, 4);

    const prompt = `Bạn là Giám đốc Sáng tạo & Biên kịch trưởng cho kênh YouTube/TikTok triệu view.
Nhiệm vụ: Dựa trên chủ đề/ý tưởng đầu vào: "${topic || channelNiche || projectName || 'Ý tưởng mới'}" và toàn bộ CẤU HÌNH KÊNH dưới đây, hãy lập kế hoạch chi tiết và sinh mẫu ý tưởng sản xuất video hoàn chỉnh.

${channelContextText}

Preset phong cách: "${effectiveConfig.systemPromptPreset || 'youtube_story'}".

QUY TẮC BẮT BUỘC:
1. TIÊU ĐỀ (title): Phải liên quan trực tiếp đến Tên Dự Án "${projectName || channelNiche}", lôi cuốn, giật gân, chuẩn SEO click-through-rate cao.
2. DÀN Ý (outline): BẮT BUỘC trả về mảng có ĐỦ TỪ ${minBeats} ĐẾN ${maxBeats} PHÂN ĐOẠN CHI TIẾT (tuyệt đối KHÔNG gộp lại thành 2-3 phân đoạn ngắn ngủi). Mỗi phân đoạn PHẢI có mốc thời gian rõ ràng dạng [mm:ss - mm:ss], mô tả chi tiết diễn biến, hình ảnh và nhịp độ kịch bản tương xứng với thời lượng ${durationLabel}.
3. HÌNH ẢNH THUMBNAIL (thumbnailConcept & thumbnailPrompt): ${
  hostName || hostDescription
    ? `BẮT BUỘC có sự xuất hiện của nhân vật ${hostName || 'đại diện'}. Cụ thể: "thumbnailPrompt" (tiếng Anh) PHẢI chứa chi tiết diện mạo và trang phục nhân vật: "featuring character ${hostName} (${hostDescription})", ánh sáng cinematic 8k, phong cách chuẩn [${visualArtStylePreset}] và model ${imageModel}. "thumbnailConcept" (tiếng Việt) phải mô tả rõ bối cảnh và hành động của nhân vật ${hostName}.`
    : `Bắt mắt, ánh sáng cinematic, phong cách [${visualArtStylePreset}], tối ưu cho model ${imageModel}.`
}

Yêu cầu nghiêm ngặt: Trả về DUY NHẤT một khối JSON hợp lệ theo đúng cấu trúc sau (không kèm lời chào, không markdown thừa):
{
  "title": "Tiêu đề video cuốn hút, gắn với dự án và chủ đề",
  "hookConcept": "Câu mở đầu 3 giây gây tò mò, giật gân, giữ chân khán giả",
  "narrativeAngle": "Góc nhìn/tiếp cận độc đáo của kênh",
  "outline": ${sampleOutlineJson},
  "estimatedDurationSec": ${targetSec},
  "thumbnailConcept": "Mô tả ý tưởng hình ảnh bìa thumbnail cực kỳ bắt mắt${hostName ? ` có sự xuất hiện của ${hostName}` : ''}",
  "thumbnailPrompt": "Detailed English image prompt for thumbnail generation, cinematic lighting, 8k, photorealistic${hostName && hostDescription ? `, featuring ${hostName}: ${hostDescription}` : ''}, optimized for ${imageModel}"
}`;

    // 1. ChatGPT Web Automation
    if (effectiveConfig.provider === 'chatgpt_web') {
      try {
        const { ChatGptWebSessionManager } = await import('../chatgpt/ChatGptWebSessionManager');
        const mgr = ChatGptWebSessionManager.getInstance();
        const mode = effectiveConfig.chatgptWebMode || 'offscreen';
        onProgress?.('Đang gửi yêu cầu sinh ý tưởng tới ChatGPT Web...');
        const targetUrl = channelProfile?.chatgptConversationUrl || mgr.getLastConversationUrl();
        const rawText = await mgr.executePromptTurn(prompt, mode, onProgress, false, targetUrl || undefined, 'idea');
        const lastUrl = mgr.getLastConversationUrl();
        if (lastUrl && channelProfile) {
          channelProfile.chatgptConversationUrl = lastUrl;
        }
        return this.parseBlueprintJson(rawText, topic, aspectRatio, channelProfile);
      } catch (err: any) {
        console.error('[AiStudioLlmService] ChatGPT Web blueprint error:', err);
        throw new Error(`Lỗi sinh ý tưởng qua ChatGPT Web: ${err?.message || err}`);
      }
    }

    // 2. Gemini Web Automation
    if (effectiveConfig.provider === 'gemini_web') {
      try {
        const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
        const mgr = GeminiWebSessionManager.getInstance();
        const mode = effectiveConfig.geminiWebMode || 'offscreen';
        onProgress?.('Đang gửi yêu cầu sinh ý tưởng tới Gemini Web...');
        const rawText = await mgr.executePromptTurn(prompt, mode, onProgress);
        return this.parseBlueprintJson(rawText, topic, aspectRatio, channelProfile);
      } catch (err: any) {
        console.error('[AiStudioLlmService] Gemini Web blueprint error:', err);
        throw new Error(`Lỗi sinh ý tưởng qua Gemini Web: ${err?.message || err}`);
      }
    }

    // 3. API Client (OpenAI, DeepSeek, Custom)
    const clientBundle = this.createClient(effectiveConfig);
    if (!clientBundle) {
      throw new Error(`Chưa cấu hình API Key cho nhà cung cấp LLM "${effectiveConfig.provider}". Vui lòng kiểm tra lại tab Cài Đặt hoặc chọn Chế độ Tiết kiệm.`);
    }

    try {
      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: effectiveConfig.temperature ?? 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      return this.parseBlueprintJson(rawText, topic, aspectRatio, channelProfile);
    } catch (err: any) {
      console.error('[AiStudioLlmService] Blueprint generation failed; provider:', config.provider);
      let message=redactLogText(String(err?.message || 'Không có blueprint hợp lệ.'));
      if(config.apiKey)message=message.split(config.apiKey).join('[REDACTED]');
      throw new Error(`Lỗi kết nối API ${config.provider}: ${message}`);
    }
  }

  // ==========================================================================
  // Stage 2: Script Generation
  // ==========================================================================
  public async generateScript(
    topic: string,
    config: AiStudioLlmConfig,
    onProgress?: (msg: string) => void,
    blueprint?: IdeaBlueprint,
    channelProfile?: ChannelProfileConfig
  ): Promise<ScriptBeatLine[]> {
    config = this.resolveChannelLlmConfig(config, channelProfile);
    // 0. Nếu người dùng đã cung cấp sẵn kịch bản (Existing Script), tự động tách câu
    if (blueprint?.existingScript && blueprint.existingScript.trim().length >= 10) {
      onProgress?.('Đang phân tách kịch bản có sẵn thành các câu độc lập...');
      const beatLines = this.splitScriptToBeatLines(blueprint.existingScript);
      if (beatLines.length > 0) {
        return beatLines;
      }
    }

    // 1. Zero-API-Cost Mode: ChatGPT Web Automation
    const effectiveTopic = blueprint?.title
      ? `${blueprint.title}${blueprint.hookConcept ? ` - Hook 3s: ${blueprint.hookConcept}` : ''}${blueprint.narrativeAngle ? ` - Góc nhìn: ${blueprint.narrativeAngle}` : ''}`
      : topic;

    // 1. Zero-API-Cost Mode: ChatGPT Web Automation
    if (config.provider === 'chatgpt_web') {
      try {
        const { ChatGptWebSessionManager, parseChatGptScriptResponse } = await import(
          '../chatgpt/ChatGptWebSessionManager'
        );
        const mgr = ChatGptWebSessionManager.getInstance();
        const mode = config.chatgptWebMode || 'offscreen';
        const rawText = await mgr.generateScriptWeb(
          effectiveTopic,
          config.systemPromptPreset || 'youtube_story',
          mode,
          onProgress,
          blueprint,
          channelProfile
        );
        const parsedLines = parseChatGptScriptResponse(rawText, topic);
        if (parsedLines.length >= 3) {
          const finalLines = channelProfile?.targetLongDuration === '20_30_sec'
            ? parsedLines.slice(0, 3)
            : this.applyChannelHook(parsedLines, channelProfile);
          return finalLines;
        }
        throw new Error('ChatGPT Web không trả về đủ số câu kịch bản hợp lệ.');
      } catch (err: any) {
        console.error('[AiStudioLlmService] ChatGPT Web script generation error:', err);
        throw new Error(`Lỗi tạo kịch bản qua ChatGPT Web: ${err?.message || err}`);
      }
    }

    // 2. Zero-API-Cost Mode: Gemini Web Automation
    if (config.provider === 'gemini_web') {
      try {
        const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
        const { parseChatGptScriptResponse } = await import('../chatgpt/ChatGptWebSessionManager');
        const mgr = GeminiWebSessionManager.getInstance();
        const mode = config.geminiWebMode || 'offscreen';
        const rawText = await mgr.generateScriptWeb(
          effectiveTopic,
          config.systemPromptPreset || 'youtube_story',
          mode,
          onProgress,
          blueprint,
          channelProfile
        );
        const parsedLines = parseChatGptScriptResponse(rawText, topic);
        if (parsedLines.length >= 3) {
          return this.applyChannelHook(parsedLines, channelProfile);
        }
        throw new Error('Gemini Web không trả về đủ số câu kịch bản hợp lệ.');
      } catch (err: any) {
        console.error('[AiStudioLlmService] Gemini Web script generation error:', err);
        throw new Error(`Lỗi tạo kịch bản qua Gemini Web: ${err?.message || err}`);
      }
    }

    // 3. API Client (OpenAI, DeepSeek, Custom)
    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      throw new Error(`Chưa cấu hình API Key cho nhà cung cấp LLM "${config.provider}". Vui lòng kiểm tra lại cấu hình.`);
    }

    try {
      const { calculateScriptPacingMetrics } = await import('../chatgpt/ChatGptWebSessionManager');
      const metrics = calculateScriptPacingMetrics(blueprint, channelProfile);

      const blueprintSource = blueprint
        ? `TIÊU ĐỀ VIDEO: ${blueprint.title || topic}
HOOK 3S: ${blueprint.hookConcept || ''}
GÓC NHÌN: ${blueprint.narrativeAngle || ''}
DÀN Ý PHÂN CẢNH CHI TIẾT:
${(blueprint.outline || []).join('\n')}
THỜI LƯỢNG MỤC TIÊU: ${metrics.targetMinutesText} (${metrics.targetDurationSec} giây, ${metrics.targetWordRange})`
        : topic;

      const masterPrompt = (channelProfile?.masterPrompt || '').trim();
      const prompt = (masterPrompt && masterPrompt.length >= 40)
        ? masterPrompt
            .replace(/\{\{CHANNEL_NAME\}\}/g, channelProfile?.channelNiche || channelProfile?.projectName || 'Kênh Vanhsub AI Studio')
            .replace(/\{\{SOURCE_MATERIAL\}\}/g, blueprintSource)
        : `Bạn là nhà biên kịch YouTube chuyên nghiệp cho kênh kể chuyện tài liệu ${metrics.isShorts ? 'ngắn' : 'dài'}.
KÊNH: "${channelProfile?.projectName || channelProfile?.channelNiche || 'Kênh Kể Chuyện AI'}"
Nhiệm vụ: Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho chủ đề: "${blueprint?.title || topic}".
${blueprint?.hookConcept ? `Hook 3 giây đầu: "${blueprint.hookConcept}".` : ''}
${blueprint?.narrativeAngle ? `Góc nhìn: "${blueprint.narrativeAngle}".` : ''}
${blueprint?.outline && blueprint.outline.length > 0 ? `Dàn ý các phân cảnh:\n${blueprint.outline.join('\n')}` : ''}
Phong cách: "${channelProfile?.channelOrientation || config.systemPromptPreset || 'youtube_story'}".
Độ dài mục tiêu: ${metrics.targetMinutesText} (khoảng ${metrics.targetWordRange}).

Yêu cầu cấu trúc Kịch bản 2 Cột Điện ảnh (Two-Column Audiovisual Script):
1. Chia kịch bản thành các câu phân cảnh độc lập (${metrics.minSentences} - ${metrics.maxSentences} câu), viết cho người nghe, đảm bảo tổng thời lượng đạt mục tiêu ${metrics.targetMinutesText}.
2. Cột 1 (Voiceover / Audio): Lời thoại lồng tiếng tự nhiên tiếng Việt ("text"), chỉ dẫn giọng đọc ("voiceDirection").
3. Cột 2 (Visual Action & Camera): Mô tả hành động chủ thể và bối cảnh ("visualAction"), góc máy & chuyển động camera chuyên nghiệp ("cameraMovement", ví dụ: 'slow dolly in', 'wide pan left to right'), và đề xuất loại media ("suggestedMediaType": "video" | "image").
4. Thời lượng video ("estimatedDurationSec") tối ưu trong khoảng 2.0s đến 8.0s (phù hợp giới hạn Google Flow Veo).
5. Câu mở đầu (index 1) PHẢI là "hook" cuốn hút gây tò mò trong 3 giây đầu.
6. Câu kết thúc PHẢI là "outro" kêu gọi hành động (đăng ký kênh, theo dõi).
7. Phân loại beatType: "hook" | "intro" | "body" | "climax" | "outro".
8. Trả về định dạng JSON DUY NHẤT có cấu trúc:
{
  "lines": [
    {
      "index": 1,
      "text": "Câu thoại lồng tiếng tiếng Việt (Cột 1)...",
      "voiceDirection": "Hồi hộp, lôi cuốn...",
      "visualAction": "Tàu con thoi từ từ bay ngang qua dải ngân hà rực rỡ (Cột 2)...",
      "cameraAngle": "wide_establishing",
      "cameraMovement": "pan_left_to_right",
      "suggestedMediaType": "video",
      "estimatedDurationSec": 4.5,
      "beatType": "hook"
    }
  ]
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature ?? 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      let lines: ScriptBeatLine[] = [];

      try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const repaired = jsonrepair(cleaned);
        const parsed = JSON.parse(repaired);
        const rawLines = Array.isArray(parsed) ? parsed : parsed.lines;
        if (!Array.isArray(rawLines) || rawLines.length < 3 || rawLines.some(item => {
          const text = item?.text ?? item?.content ?? item?.voiceover;
          return typeof text !== 'string' || !/[\p{L}\p{N}]/u.test(text);
        })) throw new Error('SCRIPT_SCHEMA_INVALID');
        if (Array.isArray(rawLines) && rawLines.length >= 3) {
          lines = rawLines.map((item: any, idx: number) => {
            const text = String(item.text || item.content || item.voiceover || '').trim();
            const finalText = text;

            const visualAction = String(
              item.visualAction || item.visual_action || item.visualNote || item.visual_note || finalText
            ).trim();

            const cameraMovement = String(
              item.cameraMovement || item.camera_movement || item.cameraDirection || 'slow push in camera'
            ).trim();

            const cameraAngle = item.cameraAngle || item.camera_angle || (idx === 0 ? 'close_up' : idx === 1 ? 'wide_establishing' : 'medium_shot');
            const suggestedMediaType = item.suggestedMediaType === 'video' || item.media_type === 'video' ? 'video' : 'image';
            const voiceDirection = item.voiceDirection || item.voice_direction;

            let estDur = Number(item.estimatedDurationSec);
            if (isNaN(estDur) || estDur <= 0) {
              const wordCount = finalText.split(/\s+/).filter(Boolean).length;
              estDur = Math.round((wordCount / 3.2) * 10) / 10;
            }
            if (suggestedMediaType === 'video') {
              estDur = Math.min(8.0, Math.max(2.0, estDur));
            } else {
              estDur = Math.max(2.0, estDur);
            }

            const beatType: ScriptBeatLine['beatType'] =
              item.beatType || (idx === 0 ? 'hook' : idx === rawLines.length - 1 ? 'outro' : 'body');

            return {
              id: `line-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
              index: idx + 1,
              text: finalText,
              voiceDirection,
              visualAction,
              cameraAngle,
              cameraMovement,
              suggestedMediaType,
              estimatedDurationSec: estDur,
              beatType,
            };
          });
        }
      } catch {
        // Malformed structured responses are failures, never narration or invented filler.
        if (/^[\s]*[\[{]|```json/i.test(rawText) || /^\s*</.test(rawText)) throw new Error('LLM trả script sai schema hoặc có dòng rỗng.');
        // Không phải JSON: Xử lý định dạng văn bản Strict Output (SCRIPT: ... --- END OF SCRIPT ---)
        let scriptBody = rawText;
        const scriptMatch = rawText.match(/SCRIPT:\s*([\s\S]*?)(?:---\s*END OF SCRIPT\s*---|NARRATION DIRECTION:|$)/i);
        if (scriptMatch && scriptMatch[1].trim().length >= 20) {
          scriptBody = scriptMatch[1].trim();
        }
        lines = this.splitScriptToBeatLines(scriptBody);
      }

      if (!lines || lines.length < 3) {
        throw new Error('LLM không trả về danh sách phân cảnh hoặc kịch bản hợp lệ.');
      }

      return this.applyChannelHook(lines, channelProfile);
    } catch (err: any) {
      let message=redactLogText(String(err?.message || 'Provider không trả kịch bản hợp lệ.'));
      if(config.apiKey)message=message.split(config.apiKey).join('[REDACTED]');
      console.error('[AiStudioLlmService] Script generation failed; provider:',config.provider);
      throw new Error(`Lỗi gọi API sinh kịch bản (${config.provider}): ${message}`);
    }
  }

  /**
   * Helper: Tự động lồng câu chốt thương hiệu (Brand Hook) của kênh vào kịch bản sau câu Hook đầu
   */
  private applyChannelHook(
    lines: ScriptBeatLine[],
    channelProfile?: ChannelProfileConfig
  ): ScriptBeatLine[] {
    if (!channelProfile?.channelHook || !channelProfile.channelHook.trim()) {
      return lines;
    }
    const hookText = channelProfile.channelHook.trim();
    const alreadyHasHook = lines.some((l) => l.text.includes(hookText));
    if (alreadyHasHook || lines.length < 2) {
      return lines;
    }

    const words = hookText.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(2.0, Math.round((words / 3.0) * 10) / 10);
    const result = [...lines];
    result.splice(1, 0, {
      id: `line-hook-${crypto.randomBytes(3).toString('hex')}`,
      index: 2,
      text: hookText,
      estimatedDurationSec: duration,
      beatType: 'intro',
    });
    result.forEach((l, idx) => {
      l.index = idx + 1;
    });
    return result;
  }

  // ==========================================================================
  // Stage 2.5: Script Evaluation (10 Dimensions D1 - D10) & Refinement
  // ==========================================================================
  public async evaluateScript(
    lines: ScriptBeatLine[],
    blueprint?: IdeaBlueprint,
    channelProfile?: Partial<ChannelProfileConfig>,
    config?: AiStudioLlmConfig
  ): Promise<ScriptEvaluation> {
    assertUsableScript(lines);

    if (!config) throw new Error('Chưa có cấu hình provider chấm điểm.');
    const evaluationConfig = resolveEvaluationConfig(config, channelProfile);
    const prompt = `Bạn là người phản biện kịch bản video. Đọc toàn bộ nội dung rồi đánh giá từng tiêu chí dựa trên chính văn bản.
Không dùng điểm cố định, không suy ra chất lượng từ vài từ khóa. Nêu chi tiết hoặc trích dẫn ngắn từ kịch bản để giải thích mỗi điểm.
Chủ đề có thể là hướng dẫn, tin tức, giải trí hay tài liệu: không bắt buộc mọi chủ đề phải có bí ẩn, khảo cổ, cao trào hoặc CTA thương mại.
D2: chỉ đánh giá mức độ có căn cứ trong tài liệu được cung cấp. Không khẳng định dữ kiện đúng khi chưa đối chiếu nguồn; chỉ rõ những phát biểu cần kiểm chứng.
Blueprint/tài liệu đầu vào: ${JSON.stringify(blueprint || {})}
Phong cách kênh: ${JSON.stringify({ name: channelProfile?.projectName, orientation: channelProfile?.channelOrientation, hook: channelProfile?.channelHook })}
Kịch bản: ${JSON.stringify(lines.map(({ id, text, voiceDirection, visualAction }) => ({ id, text, voiceDirection, visualAction })))}
Tiêu chí: ${JSON.stringify(SCRIPT_REVIEW_CRITERIA)}
Trả về DUY NHẤT JSON chứa đủ D1–D10, mỗi điểm số từ 0 đến 10 và nhận xét cụ thể:
{"criteria":[{"id":"D1","score":6,"feedback":"Nhận xét dựa trên kịch bản"}],"critique":"Điểm mạnh, điểm yếu và đề xuất ưu tiên"}.
Không tự tính điểm tổng, không khẳng định đã nghiên cứu nguồn ngoài.`;
    return parseScriptEvaluation(await this.requestScriptReview(prompt, evaluationConfig, channelProfile), evaluationConfig.provider);
  }

  private async requestScriptReview(prompt: string, config: AiStudioLlmConfig, channelProfile?: Partial<ChannelProfileConfig>): Promise<string> {
    if (config.provider === 'chatgpt_web') {
      const { ChatGptWebSessionManager } = await import('../chatgpt/ChatGptWebSessionManager');
      const manager = ChatGptWebSessionManager.getInstance();
      return manager.executePromptTurn(prompt, config.chatgptWebMode || 'offscreen', undefined, false,
        channelProfile?.chatgptConversationUrl || undefined, 'raw');
    }
    if (config.provider === 'gemini_web') {
      const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
      return GeminiWebSessionManager.getInstance().executePromptTurn(prompt, config.geminiWebMode || 'offscreen');
    }
    const bundle = this.createClient(config);
    if (!bundle) throw new Error(`Chưa cấu hình API key cho ${config.provider}.`);
    const response = await bundle.client.chat.completions.create({
      model: bundle.model, messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature ?? 0.4,
    });
    const text = response.choices[0]?.message?.content;
    if (!text?.trim()) throw new Error('Provider trả về nội dung rỗng.');
    return text;
  }

  public async refineScript(
    lines: ScriptBeatLine[],
    instructions?: string,
    mode: 'improve_weaknesses' | 'custom_prompt' = 'improve_weaknesses',
    blueprint?: IdeaBlueprint,
    channelProfile?: Partial<ChannelProfileConfig>,
    config?: AiStudioLlmConfig
  ): Promise<{ lines: ScriptBeatLine[]; evaluation?: ScriptEvaluation }> {
    if (!lines?.length) throw new Error('Chưa có kịch bản để sửa.');
    assertUsableScript(lines);
    if (!config) throw new Error('Chưa có cấu hình provider cho tập.');
    if (mode === 'custom_prompt' && !instructions?.trim()) throw new Error('Chưa nhập yêu cầu chỉnh sửa.');
    const currentEval = mode === 'improve_weaknesses' ? await this.evaluateScript(lines, blueprint, channelProfile, config) : undefined;
    const prompt = `Bạn là biên tập viên kịch bản. Sửa đúng kịch bản được cung cấp, giữ chủ đề, ngôn ngữ và dữ kiện gốc.
Không tự thêm số liệu, địa danh, phát hiện hay lời khẳng định không có trong dữ liệu đầu vào. Không bịa xung đột để tăng điểm.
Yêu cầu người dùng: ${instructions?.trim() || 'Cải thiện những điểm yếu trong nhận xét bên dưới, giữ ý nghĩa và độ dài mục tiêu.'}
Blueprint: ${JSON.stringify(blueprint || {})}
Phong cách kênh: ${JSON.stringify({ name: channelProfile?.projectName, orientation: channelProfile?.channelOrientation, hook: channelProfile?.channelHook })}
Nhận xét: ${JSON.stringify(currentEval || {})}
Kịch bản: ${JSON.stringify(lines.map(({ audioPath, startMs, endMs, durationMs, assetPath, assetType, ...line }) => line))}
Giữ nguyên số dòng, thứ tự và ID; rút gọn bằng cách sửa lời trong từng dòng. Giữ các chỉ dẫn hình ảnh/giọng đọc nếu không cần thay đổi.
Chỉ trả về JSON: {"lines":[{"id":"ID gốc","text":"Lời thoại đã sửa","visualAction":"Mô tả hình ảnh","voiceDirection":"Chỉ dẫn giọng đọc"}]}.
Không trả về audioPath, assetPath, timing hoặc điểm tự chấm.`;
    const updatedLines = parseRefinedScript(await this.requestScriptReview(prompt, config, channelProfile), lines);
    let evaluation: ScriptEvaluation | undefined;
    try { evaluation = await this.evaluateScript(updatedLines, blueprint, channelProfile, config); }
    catch (error) { console.warn('[AiStudioLlmService] Không chấm được bản sửa:', error instanceof Error ? error.message : String(error)); }
    return { lines: updatedLines, evaluation };
  }

  // ==========================================================================
  // Stage 5: Storyboard Scene Prompts Generation
  // ==========================================================================
  public generateStoryboardScenes(
    scriptLines: ScriptBeatLine[],
    flowConfig: AiStudioFlowEngineConfig,
    _llmConfig?: AiStudioLlmConfig
  ): StoryboardScene[] {
    const stylePrefix = flowConfig.stylePromptPrefix || 'Cinematic lighting, high resolution, detailed photorealistic, 4k';
    const negativePrompt = flowConfig.negativePrompt || 'watermark, text, blurry, distortion, lowres';

    const visualConceptDictionary: Record<string, string> = {
      hook: 'underwater abyss, giant glowing creature silhouette, dramatic ocean depth, volumetric light rays',
      intro: 'scientific deep sea submarine descending into dark trench, high-tech sonar display, floating particles',
      body: 'detailed exploration of unknown deep sea phenomenon, intricate textures, dramatic lighting',
      climax: 'colossal ancient underwater monolith, bioluminescent coral reefs, mysterious eerie glow',
      outro: 'cinematic sunset over calm open ocean waves, golden hour reflection, modern studio branding watermark free',
    };

    return scriptLines.map((line, idx) => {
      const beat = line.beatType || (idx === 0 ? 'hook' : idx === scriptLines.length - 1 ? 'outro' : 'body');
      const concept = visualConceptDictionary[beat] || 'cinematic atmospheric environment landscape';
      const visualPrompt = `${stylePrefix}, ${concept}, highly detailed, sharp focus, 8k wallpaper`;

      let durationSec = line.estimatedDurationSec || (line.durationMs ? line.durationMs / 1000 : 4.5);
      const isVideo = flowConfig.outputMode === 'video' || line.suggestedMediaType === 'video';
      if (isVideo) {
        durationSec = Math.min(8.0, Math.max(2.0, durationSec));
      }

      return {
        id: `scene-${idx + 1}`,
        lineIndex: idx,
        startMs: line.startMs || 0,
        endMs: line.endMs || Math.round(durationSec * 1000),
        durationMs: line.durationMs || Math.round(durationSec * 1000),
        lineText: line.text,
        visualPrompt,
        negativePrompt,
        motionType: isVideo ? 'video' : 'ken_burns',
        status: 'pending',
      };
    });
  }

  // ==========================================================================
  // Stage 5: Smart Storyboard Clustering & Prompts via LLM (Milestone 2 / R2)
  // ==========================================================================
  public async clusterAndGenerateStoryboard(options: {
    scriptLines: any[];
    timingData?: PipelineTimingData;
    stylePromptPrefix?: string;
    negativePrompt?: string;
    channelProfile?: any;
    backgroundPrompt?: string;
    config?: AiStudioLlmConfig;
    topic?: string;
  }): Promise<{ shots: any[] }> {
    const {
      scriptLines = [],
      timingData,
      stylePromptPrefix,
      channelProfile,
      backgroundPrompt,
      config,
      topic = 'Video Production',
    } = options;

    if (!scriptLines || scriptLines.length === 0) {
      return { shots: [] };
    }

    const clientBundle = config ? this.createClient(config) : null;
    if (!clientBundle) {
      throw new Error('[AiStudioLlmService] clusterAndGenerateStoryboard: Missing or invalid LLM configuration');
    }

    // Map timing data to lines
    const timingScenes = timingData?.scenes || [];
    const linesWithDuration = scriptLines.map((line: any, idx: number) => {
      const lineText = typeof line === 'string' ? line : (line.text || line.narration || '');
      const sceneId = line.scene_id || (line.id ? String(line.id) : `scene_${String(idx + 1).padStart(2, '0')}`);
      const tItem = timingScenes.find((t) => t.scene_id === sceneId) || timingScenes[idx];
      const durationSec = tItem?.duration_sec ?? (line.durationMs ? Math.round((line.durationMs / 1000) * 10) / 10 : (line.estimatedDurationSec || 3.5));
      const visualNote = line.visual_note || line.visualPromptEn || line.visualPrompt || '';
      return {
        index: idx + 1,
        scene_id: sceneId,
        text: lineText,
        duration: Math.round(durationSec * 10) / 10,
        visual_note: visualNote,
      };
    });

    const hostName = channelProfile?.hostName?.trim() || channelProfile?.channelCharacters?.[0]?.name?.trim();
    const hostDesc = channelProfile?.hostDescription?.trim() || channelProfile?.channelCharacters?.[0]?.descriptionEn?.trim();
    const visualStyle = channelProfile?.visualArtStylePreset || 'cinematic';
    const effectivePrefix = stylePromptPrefix || 'Cinematic movie lighting, 8k resolution, photorealistic masterpiece, 35mm film grain, highly detailed textures';
    const effectiveBg = backgroundPrompt || channelProfile?.projectBackgroundPrompt || 'Atmospheric cinematic environment';

    const prompt = `Bạn là Đạo diễn Hình ảnh (Director of Photography) và Chuyên gia Storyboard Điện ảnh hàng đầu.
Dự án: "${topic}"
Phong cách nghệ thuật: "${visualStyle}"
Tiền tố ánh sáng & phong cách: "${effectivePrefix}"
Bối cảnh nền chủ đạo: "${effectiveBg}"
${hostName ? `Nhân vật chủ đạo: ${hostName} (${hostDesc || 'Nhân vật chính'})` : ''}

Dưới đây là toàn bộ danh sách các câu thoại kèm thời lượng âm thanh thực tế:
${JSON.stringify(linesWithDuration, null, 2)}

QUY TẮC PHÂN CẢNH VÀ GOM CỤM (BẮT BUỘC TUÂN THỦ):
1. TUYỆT ĐỐI KHÔNG để 1 câu = 1 shot nếu câu đó ngắn dưới 4.0 giây. Số lượng phân cảnh (shots) phải giảm từ 40% đến 65% so với tổng số câu thoại gốc.
2. BẮT BUỘC gom các câu thoại liên tiếp có cùng không gian, bối cảnh, nhân vật hoặc mạch ý nghĩa thành 1 VISUAL SHOT duy nhất.
3. Mỗi shot PHẢI có tổng thời lượng từ 4.0 GIÂY đến 10.0 GIÂY (lý tưởng nhất: 5.0s đến 8.0s).
4. Mọi câu thoại từ 1 đến ${linesWithDuration.length} PHẢI được gán vào đúng 1 shot, theo thứ tự tăng dần liên tục, không được bỏ sót bất kỳ câu nào và không được trùng lặp.
5. "image_prompt": Viết bằng tiếng Anh cực kỳ chi tiết, đậm chất điện ảnh, bao quát TOÀN BỘ cụm câu thoại được gán, kết hợp bối cảnh nền và tiền tố phong cách.
6. QUY TẮC LOẠI BỎ CHỮ TRÊN ẢNH (NO TEXT / SUBTITLES ON IMAGES): Tuyệt đối KHÔNG đưa văn bản lời thoại thô, câu nói của nhân vật, chữ viết, watermark hay phụ đề vào "image_prompt" để tránh AI vẽ chữ lên ảnh. Toàn bộ nội dung lời thoại phải được chuyển thể sang mô tả bối cảnh, ánh sáng, góc quay và hành động điện ảnh. Luôn gắn kèm chỉ dẫn phủ định: "no text, no subtitles, no speech bubbles, no words, clean visual illustration" ở cuối "image_prompt".
7. "motion_note": Ghi chú chuyển động camera (tiếng Anh) phù hợp với cảnh (ví dụ: "Slow tracking dolly shot", "Gentle cinematic push in", "Dynamic pan across scene").
8. "media_type": Dựa hoàn toàn vào phân tích kịch bản:
   - Chọn "video" (hoặc img2vid): Cho các phân cảnh hành động kịch tính, biến đổi cảm xúc nhân vật rõ rệt, cao trào, hoặc chuyển động vật thể phức tạp.
   - Chọn "image": Cho các phân cảnh mô tả tĩnh, phong cảnh bao quát, tài liệu, thông tin hoặc chuyển đoạn nhẹ (kết hợp Ken Burns).
9. "reason": Giải thích ngắn gọn bằng tiếng Việt lý do chỉ định media_type ("video" hay "image") và lý do gom cụm câu thoại.

Trả về DUY NHẤT một khối JSON hợp lệ theo cấu trúc:
{
  "shots": [
    {
      "assigned_sentences": [1, 2],
      "image_prompt": "Cinematic visual prompt in English, no text, no subtitles, no speech bubbles, no words, clean visual illustration",
      "motion_note": "Slow cinematic push in...",
      "media_type": "image",
      "reason": "Phân cảnh mô tả bối cảnh tĩnh, dùng ảnh tĩnh kết hợp Ken Burns tối ưu"
    }
  ]
}`;

    const response = await clientBundle.client.chat.completions.create({
      model: clientBundle.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    });

    const rawText = response.choices[0]?.message?.content || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const repaired = jsonrepair(cleaned);
    const parsed = JSON.parse(repaired);

    const shots = Array.isArray(parsed.shots) ? parsed.shots : (Array.isArray(parsed) ? parsed : []);
    if (!Array.isArray(shots) || shots.length === 0) {
      throw new Error('[AiStudioLlmService] LLM returned empty shots array');
    }

    let nextSentence = 1;
    for (const shot of shots) {
      if (!shot || !['image','video'].includes(shot.media_type) || typeof shot.image_prompt !== 'string' || !shot.image_prompt.trim() ||
          !Array.isArray(shot.assigned_sentences) || !shot.assigned_sentences.length || shot.assigned_sentences.some((n: unknown) => !Number.isInteger(n) || n !== nextSentence++)) {
        throw new Error('LLM trả storyboard sai schema hoặc sai thứ tự/ownership câu thoại.');
      }
    }
    if (nextSentence !== scriptLines.length + 1) throw new Error('LLM storyboard bỏ sót hoặc vượt số câu thoại.');

    // Validate and sanitize shots
    const validShots = shots.map((s: any, idx: number) => {
      const assigned = Array.isArray(s.assigned_sentences)
        ? s.assigned_sentences.map((n: any) => Number(n)).filter((n: number) => !isNaN(n) && n >= 1)
        : [idx + 1];
      const mediaType: 'image' | 'video' = s.media_type === 'video' ? 'video' : 'image';
      let cleanPrompt = String(s.image_prompt || `${effectivePrefix}, ${effectiveBg}`).trim();
      // Remove any leftover dialogue quotes and speaker/dialogue markers
      cleanPrompt = cleanPrompt.replace(/^(?:người dẫn|dẫn chuyện|nhân vật|mc|host|narrator|voiceover|speaker)[\s\d]*:?\s*/gi, '');
      cleanPrompt = cleanPrompt.replace(/(?:lời thoại|phụ đề|câu nói|subtitles?|dialogue):?\s*/gi, '').trim();
      cleanPrompt = cleanPrompt.replace(/["“”'‘’«»]/g, '').trim();
      if (!cleanPrompt.toLowerCase().includes('no text')) {
        cleanPrompt += ', no text, no subtitles, no speech bubbles, no words, clean visual illustration';
      }
      return {
        scene_index: idx + 1,
        assigned_sentences: assigned,
        image_prompt: cleanPrompt,
        motion_note: String(s.motion_note || 'Slow cinematic push in').trim(),
        media_type: mediaType,
        reason: String(s.reason || `Phân cảnh cụm câu [${assigned.join(', ')}]: chỉ định ${mediaType} theo nhịp kịch bản`).trim(),
        confidence: s.confidence || 'high',
      };
    });

    return { shots: validShots };
  }

  // ==========================================================================
  // Stage 8: Viral SEO Metadata Generation
  // ==========================================================================
  public async generateSeoMetadata(
    topic: string,
    scriptLines: ScriptBeatLine[],
    config?: AiStudioLlmConfig
  ): Promise<SeoMetadata> {
    const clientBundle = config ? this.createClient(config) : null;
    if (!clientBundle) {
      if (config) throw new Error('Provider đã chọn chưa có adapter SEO tự động; không dùng metadata mẫu để báo thành công.');
      return this.generateFallbackSeo(topic, scriptLines);
    }

    try {
      const summaryText = scriptLines.map((l) => l.text).join(' ');
      const prompt = `Bạn là chuyên gia tối ưu hóa video YouTube & TikTok (SEO Specialist).
Dựa trên kịch bản video sau về chủ đề "${topic}":
"${summaryText.slice(0, 1000)}"

Hãy tạo bộ siêu dữ liệu SEO lan truyền (viral metadata):
Trả về JSON DUY NHẤT:
{
  "title": "Tiêu đề giật tít chuẩn CTR cao (10-100 ký tự)",
  "description": "Mô tả video chi tiết hấp dẫn có kêu gọi hành động (ít nhất 50 ký tự)",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "thumbnailPrompt": "Cinematic visual prompt tiếng Anh để sinh ảnh thumbnail ấn tượng (ít nhất 20 ký tự)"
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      const title = String(parsed.title || '').trim();
      const validTitle = title.length >= 10 && title.length <= 100
        ? title
        : '';

      const description = String(parsed.description || '').trim();
      const validDesc = description.length >= 50
        ? description
        : '';

      let hashtags: string[] = [];
      if (Array.isArray(parsed.hashtags) && parsed.hashtags.length >= 3) {
        hashtags = parsed.hashtags.map((h: string) => {
          const clean = String(h).replace(/\s+/g, '');
          return clean.startsWith('#') ? clean : `#${clean}`;
        });
      }
      if (hashtags.length < 3) {
        throw new Error('SEO thiếu hashtag hợp lệ.');
      }

      const thumbnailPrompt = String(parsed.thumbnailPrompt || '').trim();
      const validThumb = thumbnailPrompt.length >= 20
        ? thumbnailPrompt
        : '';
      if (!validTitle || !validDesc || !validThumb) throw new Error('SEO không đúng schema.');

      return {
        title: validTitle,
        description: validDesc,
        hashtags,
        thumbnailPrompt: validThumb,
      };
    } catch {
      throw new Error('Provider LLM không tạo được SEO hợp lệ. Video đã có được giữ nguyên; có thể nhập metadata thủ công ngoài luồng tự động.');
    }
  }

  // ==========================================================================
  // Script Quality Audit (Audience Retention Score 0-100)
  // ==========================================================================
  public async auditScriptQuality(
    scriptLines: ScriptBeatLine[],
    config?: AiStudioLlmConfig
  ): Promise<ScriptQualityAuditResult> {
    const clientBundle = config ? this.createClient(config) : null;
    if (!clientBundle || scriptLines.length === 0) {
      return this.auditScriptHeuristically(scriptLines);
    }

    try {
      const scriptDump = scriptLines.map((l, i) => `${i + 1}. [${l.beatType || 'beat'}] ${l.text}`).join('\n');
      const prompt = `Bạn là chuyên gia thẩm định kịch bản video ngắn hàng đầu (Audience Retention Auditor).
Hãy đánh giá kịch bản sau:
${scriptDump}

Chấm điểm trên thang 100 và trả về JSON DUY NHẤT:
{
  "retentionScore": 85,
  "hookScore": 90,
  "pacingScore": 80,
  "hookAnalysis": "Đánh giá chi tiết câu mở đầu",
  "retentionLoopSuggestions": ["Góp ý 1 để giữ chân người xem", "Góp ý 2"],
  "ctaEvaluation": "Đánh giá câu kêu gọi hành động cuối",
  "overallFeedback": "Nhận xét tổng quan"
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      return {
        retentionScore: Math.max(0, Math.min(100, Math.round(Number(parsed.retentionScore) || 82))),
        hookScore: Math.max(0, Math.min(100, Math.round(Number(parsed.hookScore) || 85))),
        pacingScore: Math.max(0, Math.min(100, Math.round(Number(parsed.pacingScore) || 80))),
        hookAnalysis: parsed.hookAnalysis || 'Mở đầu ấn tượng, kích thích sự tò mò của khán giả.',
        retentionLoopSuggestions: Array.isArray(parsed.retentionLoopSuggestions) && parsed.retentionLoopSuggestions.length > 0
          ? parsed.retentionLoopSuggestions
          : ['Duy trì nhịp đọc vừa phải (15 - 25 từ/câu)', 'Bổ sung âm thanh hiệu ứng ở điểm cao trào'],
        ctaEvaluation: parsed.ctaEvaluation || 'Kêu gọi hành động rõ ràng và tự nhiên.',
        overallFeedback: parsed.overallFeedback || 'Kịch bản có cấu trúc tốt, sẵn sàng cho công đoạn sản xuất video.',
      };
    } catch {
      return this.auditScriptHeuristically(scriptLines);
    }
  }

  // ==========================================================================
  // Procedural Fallback Generators
  // ==========================================================================
  public generateFallbackBlueprint(topic: string, preset = 'youtube_story'): IdeaBlueprint {
    return {
      topic,
      targetAudience: 'Khán giả đại chúng yêu thích video thông tin nhanh, kịch tính và giàu hình ảnh',
      narrativeAngle: 'Khám phá những bí ẩn chưa từng được giải đáp',
      hookConcept: `Bạn có tin vào những bí ẩn lớn nhất về ${topic}?`,
      pacing: preset === 'tiktok_short' ? 'fast' : 'moderate',
      estimatedDurationSec: 20,
      keyBeats: [
        'Đặt câu hỏi kích thích tò mò',
        'Cung cấp dữ kiện bất ngờ',
        'Phân tích chi tiết cao trào',
        'Kêu gọi hành động và theo dõi kênh',
      ],
      rawSummary: `Video 4 nhịp tập trung vào yếu tố giật gân và giá trị thực tế của "${topic}".`,
    };
  }

  public generateFallbackScript(topic: string, _preset = 'youtube_story'): ScriptBeatLine[] {
    return [
      {
        id: `line-1-${crypto.randomBytes(3).toString('hex')}`,
        index: 1,
        text: `Chào mừng bạn đến với hành trình khám phá ${topic}. Bạn có tin vào những bí ẩn chưa từng được tiết lộ?`,
        voiceDirection: 'Giọng trầm ấm, hồi hộp, gây tò mò',
        visualAction: `Góc quay cận cảnh mở ra thế giới bí ẩn của ${topic}`,
        cameraAngle: 'close_up',
        cameraMovement: 'slow dolly in, focus pull',
        suggestedMediaType: 'video',
        estimatedDurationSec: 4.5,
        beatType: 'hook',
      },
      {
        id: `line-2-${crypto.randomBytes(3).toString('hex')}`,
        index: 2,
        text: 'Ở độ sâu hàng ngàn mét, áp suất và bóng tối bao trùm, các nhà khoa học đã ghi nhận những âm thanh kỳ lạ.',
        voiceDirection: 'Kể chuyện sâu lắng, dẫn dắt',
        visualAction: 'Tàu lặn khoa học từ từ chìm vào bóng tối đại dương bao la',
        cameraAngle: 'wide_establishing',
        cameraMovement: 'pan_left_to_right',
        suggestedMediaType: 'video',
        estimatedDurationSec: 5.0,
        beatType: 'intro',
      },
      {
        id: `line-3-${crypto.randomBytes(3).toString('hex')}`,
        index: 3,
        text: 'Những sinh vật phát quang bí ẩn và cấu trúc địa chất khổng lồ thách thức mọi định luật vật lý hiện đại.',
        voiceDirection: 'Kịch tính, dồn dập, nhấn mạnh cao trào',
        visualAction: 'Sinh vật phát quang khổng lồ lướt qua tảng cự thạch cổ đại dưới đáy biển',
        cameraAngle: 'low_angle',
        cameraMovement: 'dolly_in',
        suggestedMediaType: 'video',
        estimatedDurationSec: 5.2,
        beatType: 'climax',
      },
      {
        id: `line-4-${crypto.randomBytes(3).toString('hex')}`,
        index: 4,
        text: 'Hãy đăng ký kênh Vanhsub AI Studio ngay hôm nay để không bỏ lỡ những phát hiện chấn động tiếp theo.',
        voiceDirection: 'Tươi sáng, kết nối, kêu gọi hành động',
        visualAction: 'Khung cảnh hoàng hôn biển tĩnh lặng với logo kênh xuất hiện trang nhã',
        cameraAngle: 'wide_establishing',
        cameraMovement: 'static',
        suggestedMediaType: 'image',
        estimatedDurationSec: 4.8,
        beatType: 'outro',
      },
    ];
  }

  public generateFallbackSeo(topic: string, _scriptLines: ScriptBeatLine[]): SeoMetadata {
    return {
      title: `${topic} — 5 Bí Ẩn Rùng Mình Chưa Ai Giải Mã Được`,
      description: `Khám phá chi tiết về chủ đề: ${topic}. Video được sản xuất tự động hoàn chỉnh từ Kịch bản, Giọng đọc AI đến Hình ảnh bởi Vanhsub AI Video Studio. Đừng quên bấm Like và Đăng Ký kênh!`,
      hashtags: ['#vanhsub', '#bian', '#daiduong', '#khampha', '#khoahoc', '#aivideo'],
      thumbnailPrompt: `Cinematic eye-level shot of a colossal glowing eye opening in the pitch black oceanic abyss, submarine searchlight beam revealing ancient ruins, high CTR YouTube thumbnail style, vivid contrast, 8k resolution`,
    };
  }

  public auditScriptHeuristically(scriptLines: ScriptBeatLine[]): ScriptQualityAuditResult {
    const totalLines = scriptLines.length;
    const firstLine = scriptLines[0]?.text || '';
    const lastLine = scriptLines[totalLines - 1]?.text || '';

    const hasQuestion = /[?？]/.test(firstLine);
    const hasCuriosityWords = /(bí ẩn|sự thật|kinh ngạc|chưa từng|tại sao|liệu|bạn có biết|khám phá)/i.test(firstLine);
    const hookScore = Math.min(95, 60 + (hasQuestion ? 20 : 0) + (hasCuriosityWords ? 15 : 0));

    const hasCta = /(đăng ký|theo dõi|like|share|bình luận|comment|kênh)/i.test(lastLine);
    const pacingScore = totalLines >= 4 && totalLines <= 12 ? 85 : 70;
    const retentionScore = Math.round(hookScore * 0.45 + pacingScore * 0.35 + (hasCta ? 20 : 10));

    return {
      retentionScore,
      hookScore,
      pacingScore,
      hookAnalysis: hasCuriosityWords
        ? 'Hook mở đầu rất tốt, kích thích mạnh mẽ trí tò mò của khán giả.'
        : 'Hook mở đầu ổn định; có thể bổ sung thêm câu hỏi hoặc từ khóa tạo sự bất ngờ.',
      retentionLoopSuggestions: [
        'Giữ độ dài các câu thoại đồng đều trong khoảng 15 - 25 từ để duy trì nhịp lôi cuốn',
        'Bổ sung hiệu ứng chuyển cảnh Ken Burns để tăng tính sinh động thị giác',
      ],
      ctaEvaluation: hasCta
        ? 'Kêu gọi hành động rõ ràng và tự nhiên ở cuối video.'
        : 'Nên bổ sung lời nhắc đăng ký kênh hoặc bấm like ở câu cuối.',
      overallFeedback: `Kịch bản đạt ${retentionScore}/100 điểm giữ chân khán giả, tối ưu cho video dạng ngắn và trung bình.`,
    };
  }

  // ==========================================================================
  // Channel Master Prompt Generation
  // ==========================================================================
  public async generateMasterPromptForChannel(
    channelProfile: Partial<ChannelProfileConfig>,
    config?: AiStudioLlmConfig,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    if (config) config = this.resolveChannelLlmConfig(config, channelProfile);
    const projectName = (channelProfile.projectName || channelProfile.channelNiche || 'Kênh YouTube').trim();
    const niche = channelProfile.channelNiche || projectName || 'Nội dung khám phá & kiến thức chuyên sâu';
    const desc = channelProfile.channelDescription || 'Kênh chia sẻ những câu chuyện và góc nhìn độc đáo, hấp dẫn.';
    const orient = channelProfile.channelOrientation || 'Kịch tính, lôi cuốn, tạo sự đồng cảm và kích thích trí tò mò.';
    const hook = channelProfile.channelHook || 'Hãy cùng chúng tôi khám phá ngay bây giờ.';
    const durationLong = channelProfile.targetLongDuration || '3_5_min';
    const targetMinutes = durationLong.replace('_', '–').replace('min', 'phút');

    const effectiveProvider =
      channelProfile?.aiProvider && channelProfile.aiProvider !== 'default'
        ? channelProfile.aiProvider
        : config?.provider || 'deepseek';

    let aiModelName = 'AI Studio LLM';
    if (effectiveProvider === 'gemini_web') {
      aiModelName = 'Gemini Web (Zero-API Cost)';
    } else if (effectiveProvider === 'chatgpt_web') {
      aiModelName = 'ChatGPT Web (Zero-API Cost)';
    } else if (effectiveProvider === 'deepseek') {
      aiModelName = `DeepSeek (${config?.model || 'deepseek-chat'})`;
    } else if (effectiveProvider === 'openai') {
      aiModelName = `OpenAI (${config?.model || 'gpt-4o'})`;
    } else {
      aiModelName = config?.model || effectiveProvider;
    }

    // 10-Section Fallback Template complying 100% with the user's Master Prompt Standard
    const promptTemplate = `1. SYSTEM ROLE
Bạn là nhà biên kịch lồng tiếng cao cấp chạy trên mô hình AI "${aiModelName}" cho project / kênh YouTube "${projectName}".
Khán giả của kênh là những người yêu thích tìm hiểu sâu, khao khát những góc nhìn chân thực, sắc sảo và kịch tính.
Lời hứa của kênh với người xem: mỗi câu chuyện đều được bóc tách đến tận cùng sự thật, cuốn hút từng giây và không bao giờ lãng phí thời gian của bạn.

2. INPUT

CHANNEL NAME:

{{CHANNEL_NAME}}

=== SOURCE START ===

{{SOURCE_MATERIAL}}

=== SOURCE END ===

Everything inside the markers is the universe of established fact. You may add general, verifiable context about how a system or process works, because that context is the transformation. You may never add facts about these specific people or events.

3. PRIMARY OBJECTIVE
- Độ dài mục tiêu: ${targetMinutes} (khoảng 600–1.200 từ lồng tiếng).
- Phải giống: một bộ phim tài liệu điều tra điện ảnh thu nhỏ, kể chuyện với nhịp điệu dồn dập, sắc bén và giàu sức gợi cảm giác thực tế.
- Tuyệt đối KHÔNG giống: một bài báo đọc to đều đều; một bài tóm tắt sách khô khan; một câu chuyện phiếm mạng xã hội nhạt nhòa; một bài giảng đạo đức.

4. CHANNEL DNA
- Ngách trọng tâm: ${niche}.
- Bản sắc kênh: ${desc}
- Định hướng góc nhìn: ${orient}
- Tôn chỉ văn phong: Trực diện, không vòng vo, cụ thể thắng trừu tượng, mỗi câu nói đều mang sức nặng thông tin.

4B. BRAND IDENTITY
- BRAND COMPASS: Kênh ${projectName} luôn đi thẳng vào bản chất vấn đề trước khi người khác kịp thanh minh.
- KHÔNG nhắc tên kênh trong 40 giây đầu của video.
- Giới thiệu thương hiệu trong khoảng 0:40–1:30 (8–12 giây). Câu mẫu:
  + "Chào mừng quý vị quay trở lại với {{CHANNEL_NAME}}, nơi chúng tôi cùng bạn bóc tách những bí ẩn chấn động nhất của câu chuyện hôm nay."
  + "Bạn đang theo dõi {{CHANNEL_NAME}}, và những gì sắp diễn ra sẽ làm thay đổi hoàn toàn cách bạn nhìn nhận sự việc này."
- Ký tên thương hiệu ở 30 giây cuối:
  + "Cảm ơn bạn đã đồng hành cùng {{CHANNEL_NAME}}. Câu trả lời cuối cùng nằm ở góc nhìn của bạn."
  + "{{CHANNEL_NAME}} xin chào và hẹn gặp lại trong hồ sơ tiếp theo."
- Tối đa hai lần nhắc tên trong cả tập. Cấm nhắc tên trong đoạn cao trào hoặc đoạn chứng cứ.

5. SIGNATURE BEAT
- Khoảng phút 2:30 hoặc trước bước ngoặt lớn: "Đoạn đóng băng sự việc" — người dẫn dừng nhịp 1.5 giây, đặt một câu hỏi cốt tử về động cơ của nhân vật trước khi lật mở bằng chứng quyết định.

6. NGUỒN & SỰ THẬT
- Nhóm A (Trong nguồn): Sự kiện, tên người, mốc thời gian, số liệu có trong nguồn là bất khả xâm phạm.
- Nhóm B (Bối cảnh chung): Được phép bổ sung kiến thức lịch sử, địa lý, cơ chế hoạt động để làm rõ câu chuyện.
- Nhóm C (Suy diễn - CẤM): Cấm bịa đặt lời thoại trực tiếp, cấm gán ghép động cơ cá nhân khi nguồn không khẳng định.

7. CẤU TRÚC TẬP
- 00:00 - 00:40: Hook búa bổ mở đầu bằng danh từ riêng hoặc con số chấn động. Đặt ngay mâu thuẫn lớn nhất.
- 00:40 - 01:30: Lời hứa tập này, giới thiệu kênh ngắn gọn và bắt đầu dòng thời gian.
- 01:30 - Cao trào: Diễn biến leo thang, các nỗ lực bất thành và sự đổ vỡ.
- Cao trào: Điểm bùng nổ, câu văn ngắn nhất, cảm xúc dồn nén.
- Kết thúc: Đúc kết sắc sảo, câu hỏi mở cho khán giả và chữ ký kênh.

8. NARRATION & DELIVERY
- Spell every number as spoken: "two hundred and eleven thousand dollars", "nine days", "nineteen eighty-three". Never emit raw digits.
- No symbols at all: no dollar sign, percent sign, ampersand, slash, or arrow.
- The SCRIPT section contains narration and nothing else: no headings, no timestamps, no stage directions, no speaker labels, no bracketed cues.
- Mở bằng danh từ riêng hoặc con số cụ thể. Cấm mở bằng câu hỏi tu từ hay "trong video này".
- Cấm nói trước cấu trúc. Đi thẳng vào sự việc.
- Tối đa 2 câu giải thích liên tiếp; câu thứ ba phải là cảnh, người, con số hoặc hành động.
- Xen kẽ câu dài với các câu cực ngắn (3–5 từ) để tạo nhịp thở hồi hộp.
- Cao trào cảm xúc phải là câu văn đơn giản nhất, không dùng từ ngữ sáo rỗng.

9. STRICT OUTPUT FORMAT

IF REJECTED:

STATUS: REJECTED
REASON: [one concise line]

IF ACCEPTED:

TITLE: [final title]

SCRIPT:

[complete narration script, plain text, no headings, no timestamps, no stage directions]

--- END OF SCRIPT ---

NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any name or place]

Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or music instructions, no commentary.`;

    // Nếu người dùng có LLM provider sẵn sàng, chạy prompt meta chuyên gia để sinh prompt tối ưu
    const hasActiveLlm =
      effectiveProvider === 'chatgpt_web' ||
      effectiveProvider === 'gemini_web' ||
      Boolean(config);

    if (hasActiveLlm) {
      try {
        onProgress?.(`Đang kết nối AI Provider (${aiModelName}) để tạo Production Master Prompt...`);
        const userPrompt = `Bạn là chuyên gia viết PRODUCTION MASTER PROMPT cho kênh YouTube kể chuyện dài.

Nhiệm vụ: từ mô tả kênh dưới đây, viết ra MỘT master prompt hoàn chỉnh — loại prompt mà người ta dán
vào AI cùng với một nguồn (bài báo, hồ sơ, chủ đề) và nhận về kịch bản lồng tiếng hoàn chỉnh.

Bạn KHÔNG viết kịch bản. Bạn viết cái prompt sinh ra kịch bản đó.

==================================================
PHẦN A — KHUÔN BẮT BUỘC
==================================================

Master prompt bạn viết phải có đủ 10 mục, đúng thứ tự này:

1. SYSTEM ROLE — model đóng vai ai, viết cho kênh nào (GỌI ĐÚNG TÊN KÊNH), khán giả nào, hứa hẹn gì
   với người xem. Mô hình AI chỉ định: "${aiModelName}".
2. INPUT — vùng nhận nguồn, bọc bằng marker (xem PHẦN B).
3. PRIMARY OBJECTIVE — độ dài mục tiêu theo phút và theo số từ; phải giống cái gì, và phải KHÔNG
   giống cái gì (nêu 3-5 thứ cụ thể như "một bài báo đọc to", "truyện Reddit đổi tên").
4. CHANNEL DNA — 3-4 dòng ngắn định nghĩa kênh này khác kênh cùng ngách ở chỗ nào.
4B. BRAND IDENTITY — nhận diện thương hiệu, xem PHẦN B4.
5. SIGNATURE BEAT — MỘT đoạn đặc trưng mà người xem quen chờ đợi ở mỗi tập. Đây là tài sản nhận diện
   mạnh nhất của kênh; mô tả rõ nó nằm ở đâu trong tập và làm gì.
6. NGUỒN & SỰ THẬT — phân loại dữ kiện (A = có trong nguồn, B = bối cảnh chung có thể kiểm chứng,
   C = suy diễn, cấm). Nêu rõ được thêm gì và tuyệt đối không được thêm gì.
7. CẤU TRÚC TẬP — chia theo mốc thời gian hoặc theo beat, nói rõ mỗi phần làm gì.
8. NARRATION & DELIVERY — viết cho TAI, không cho mắt (xem PHẦN B).
9. STRICT OUTPUT FORMAT — chép nguyên văn từ PHẦN B, không sửa một ký tự.

==================================================
PHẦN B — VÙNG CẤM SỬA
==================================================

Ba khối dưới đây là hợp đồng kỹ thuật với phần mềm chạy master prompt này. Chép NGUYÊN VĂN vào master
prompt bạn viết. Không diễn đạt lại, không rút gọn, không dịch, không gộp vào mục khác.

--- B1. VÙNG NHẬN NGUỒN (đặt ở mục 2 INPUT) ---

CHANNEL NAME:

{{CHANNEL_NAME}}

=== SOURCE START ===

{{SOURCE_MATERIAL}}

=== SOURCE END ===

Everything inside the markers is the universe of established fact. You may add general, verifiable
context about how a system or process works, because that context is the transformation. You may never
add facts about these specific people or events.

--- B2. LUẬT ĐỌC THÀNH TIẾNG (đặt trong mục 8 NARRATION) ---

- Spell every number as spoken: "two hundred and eleven thousand dollars", "nine days", "nineteen
  eighty-three". Never emit raw digits.
- No symbols at all: no dollar sign, percent sign, ampersand, slash, or arrow.
- The SCRIPT section contains narration and nothing else: no headings, no timestamps, no stage
  directions, no speaker labels, no bracketed cues.

--- B4. NHẬN DIỆN THƯƠNG HIỆU (mục 4B) ---

Viết mục 4B theo đúng bộ luật này, thay [[CHANNEL_NAME]] bằng tên kênh thật ở phần mô tả, nhưng giữ
{{CHANNEL_NAME}} ở mọi CÂU MẪU mà người dẫn sẽ đọc trên sóng:

- BRAND COMPASS: một câu nội bộ tóm gọn kênh này đứng ở đâu. Không bao giờ đọc nguyên văn trên sóng.
  Người xem phải nhận ra kênh qua CÁCH LÀM trước, qua cái tên sau.
- KHÔNG nhắc tên kênh trong 40 giây đầu. Đó là đoạn tụt người xem mạnh nhất; đặt tên ở đó là mất
  người xem có thể đo được.
- MỘT câu giới thiệu thương hiệu trong khoảng 0:40–1:30, dài 8–12 giây khi đọc. Ba việc rồi thôi:
  tên kênh + lời hứa của kênh diễn đạt riêng cho tập này + quay lại câu chuyện ngay. Mỗi tập viết
  một câu khác nhau, không lặp lại câu của tập trước. Cho 2–3 câu MẪU dùng {{CHANNEL_NAME}}.
- MỘT câu ký tên ở 30 giây cuối. Cho 2–3 câu mẫu, cũng dùng {{CHANNEL_NAME}}.
- Tối đa HAI lần nhắc tên trong cả tập, tuyệt đối không quá ba.
- CẤM nhắc tên bên trong: đoạn dẫn chứng, signature beat, và cao trào cảm xúc.
- Tối đa MỘT lời kêu gọi, gắn vào câu hỏi kết. Không xếp chồng like–đăng ký–chuông.
- PHÉP THỬ ĐỘ SÂU: bỏ hẳn tên kênh đi, người xem quen có nhận ra kênh này qua hai phút bất kỳ không?
  Nếu không thì nhận diện đang là trang trí — sửa giọng và signature beat, ĐỪNG thêm lần nhắc tên.

--- B3. HỢP ĐỒNG OUTPUT (mục 9, luôn là mục CUỐI CÙNG) ---

STRICT OUTPUT FORMAT

IF REJECTED:

STATUS: REJECTED
REASON: [one concise line]

IF ACCEPTED:

TITLE: [final title]

SCRIPT:

[complete narration script, plain text, no headings, no timestamps, no stage directions]

--- END OF SCRIPT ---

NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any
name or place]

Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or
music instructions, no commentary.

==================================================
PHẦN C — CỔNG NGUỒN: ĐỂ NHẸ
==================================================

Master prompt được phép trả \`STATUS: REJECTED\`, nhưng bạn phải đặt ngưỡng NHẸ:

- Reject KHI: vùng nguồn trống, hoặc nội dung không liên quan gì tới ngách của kênh.
- KHÔNG reject vì: nguồn ngắn, nguồn thiếu chi tiết, nguồn chỉ có vài đoạn.

Lý do: người dùng chạy kênh hằng ngày. Ngưỡng khắt khe làm video dừng liên tục và họ tưởng phần mềm
hỏng. Khi nguồn mỏng, hãy dặn model thu hẹp phạm vi và viết ngắn hơn mục tiêu — đừng từ chối, và cũng
đừng bịa cho đủ thời lượng.

==================================================
PHẦN D — CHẤT LƯỢNG VĂN
==================================================

Nhét các luật này vào mục 8, diễn đạt theo giọng của kênh:

- Mở bằng một danh từ riêng hoặc một con số cụ thể. Cấm mở bằng câu hỏi tu từ, cấm chào, cấm "trong
  video này".
- Cấm nói trước cấu trúc ("đầu tiên chúng ta sẽ…", "tóm lại…"). Nói thẳng vào việc.
- Tối đa 2 câu giải thích liên tiếp. Câu thứ ba phải là một cảnh, một người, một con số, một đồ vật.
- Cụ thể thắng trừu tượng: "ông ấy đếm ba lần rồi mới ký" thay vì "ông ấy rất cẩn thận".
- Nhịp câu phải đổi. Xen câu dài với câu rất ngắn.
- Cấm nhắc lại một ý đã nói bằng cách diễn đạt khác.
- Cao trào cảm xúc phải là câu văn ĐƠN GIẢN nhất trong tập, không phải câu hoa mỹ nhất.
- Kết bằng chi tiết riêng của câu chuyện này. Nếu đoạn kết có thể gắn vào mười tập khác thì viết lại.

==================================================
PHẦN E — ĐẦU VÀO
==================================================

Thông tin kênh:
- Tên kênh / Project: ${projectName}
- Mô hình AI sử dụng: ${aiModelName}
- Kiểu video (engine): Google Flow (Veo & Imagen)
- Ngách: ${niche}
- Mô tả kênh: ${desc}
- Định hướng / nhấn mạnh: ${orient}
- Ngôn ngữ kịch bản: Tiếng Việt
- Độ dài mục tiêu: ${targetMinutes}
- Loại nguồn thường dùng: Bài báo, tư liệu lịch sử, hồ sơ sự kiện, kịch bản phác thảo

Tên kênh ở trên là TÊN THẬT. Viết nó thẳng vào mục 1 (SYSTEM ROLE), mục 4 (CHANNEL DNA) và mục 4B
(BRAND IDENTITY) của master prompt bạn tạo ra, để prompt đọc lên là ra ngay kênh nào.

Nhưng ở mục 2 (INPUT) và ở CÁC CÂU MẪU mà người dẫn sẽ đọc trên sóng thì phải giữ nguyên chuỗi
{{CHANNEL_NAME}} — đó là chỗ phần mềm tự điền lúc chạy. Đổi tên kênh sau này thì mọi câu đọc tự cập
nhật, không phải viết lại master prompt.

==================================================
PHẦN F — CÁCH TRẢ LỜI
==================================================

Viết master prompt bằng ngôn ngữ Tiếng Việt (vì kịch bản nó sinh ra sẽ ở ngôn ngữ đó), TRỪ ba khối
ở PHẦN B — chép nguyên văn tiếng Anh.

Độ dài master prompt: 150–250 dòng. Đủ chặt để chạy được, không dài tới mức không ai đọc nổi.

Trả về DUY NHẤT nội dung master prompt. Không lời dẫn, không giải thích, không bọc trong khối code.
Bắt đầu ngay bằng mục 1 SYSTEM ROLE.`;

        let resultText = '';
        if (effectiveProvider === 'chatgpt_web') {
          const { ChatGptWebSessionManager } = await import('../chatgpt/ChatGptWebSessionManager');
          const mgr = ChatGptWebSessionManager.getInstance();
          const mode = config?.chatgptWebMode || 'offscreen';
          resultText = await mgr.executePromptTurn(userPrompt, mode, onProgress, true, undefined, 'master_prompt');
          const newUrl = mgr.getLastConversationUrl();
          if (newUrl && channelProfile) {
            channelProfile.chatgptConversationUrl = newUrl;
          }
        } else if (effectiveProvider === 'gemini_web') {
          const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
          const mgr = GeminiWebSessionManager.getInstance();
          const mode = config?.geminiWebMode || 'offscreen';
          resultText = await mgr.executePromptTurn(userPrompt, mode, onProgress);
        } else if (config) {
          const clientBundle = this.createClient({ ...config, provider: effectiveProvider });
          if (!clientBundle) throw new Error(`Chưa cấu hình API Key cho ${effectiveProvider}.`);
          if (clientBundle) {
            const resp = await clientBundle.client.chat.completions.create({
              model: clientBundle.model,
              messages: [{ role: 'user', content: userPrompt }],
              temperature: 0.7,
            });
            resultText = resp.choices[0]?.message?.content || '';
          }
        }

        if (resultText && resultText.trim().length >= 100) {
          if (!['SYSTEM ROLE', 'CHANNEL DNA', 'STRICT OUTPUT FORMAT'].every(section => resultText.toUpperCase().includes(section)) ||
              !/\{\{\s*CHANNEL_NAME\s*\}\}/i.test(resultText) || !/\{\{\s*SOURCE_MATERIAL\s*\}\}/i.test(resultText)) {
            throw new Error('Phản hồi thiếu cấu trúc hoặc biến đầu vào của Master Prompt.');
          }
          // Bảo vệ: Nếu vô tình bắt dính prompt template hướng dẫn, bỏ qua để không ghi đè master prompt hỏng
          if (
            resultText.includes('PHẦN F — CÁCH TRẢ LỜI') ||
            resultText.includes('PHẦN B — VÙNG CẤM SỬA') ||
            resultText.includes('PHẦN E — ĐẦU VÀO') ||
            resultText.includes('PHẦN A — KHUÔN BẮT BUỘC') ||
            resultText.includes('Ba khối dưới đây là hợp đồng kỹ thuật') ||
            resultText.includes('Bạn là chuyên gia viết PRODUCTION MASTER PROMPT') ||
            resultText.includes('Bạn KHÔNG viết kịch bản') ||
            resultText.includes('… Xem thêm') ||
            resultText.includes('ChatGPT đang phản hồi')
          ) {
            throw new Error('ChatGPT trả về nội dung lặp prompt đầu vào. Master prompt hiện tại được giữ nguyên.');
          }

          // Chuẩn hóa tên AI model nếu model trả về tên cũ hoặc hallucination
          const cleanText = resultText.trim().replace(
            /(Bạn là nhà biên kịch lồng tiếng cao cấp chạy trên mô hình AI\s*")[^"]+("\s*cho)/i,
            `$1${aiModelName}$2`
          );
          return cleanText;
        }
        throw new Error('AI không trả về master prompt hợp lệ (nội dung trống hoặc quá ngắn).');
      } catch (err) {
        console.warn('[AiStudioLlmService] Remote master prompt generation failed:', err);
        throw err;
      }
    }

    return promptTemplate;
  }
}

// Module-level exported helpers for direct test harness imports
export const aiStudioLlmService = AiStudioLlmService.getInstance();
export const generateScript = (
  topic: string,
  cfg: AiStudioLlmConfig,
  onProgress?: (msg: string) => void
) => aiStudioLlmService.generateScript(topic, cfg, onProgress);
export const analyzeIdeaBlueprint = (topic: string, cfg: AiStudioLlmConfig) =>
  aiStudioLlmService.analyzeIdeaBlueprint(topic, cfg);
export const generateStoryboardScenes = (
  lines: ScriptBeatLine[],
  flowCfg: AiStudioFlowEngineConfig,
  llmCfg?: AiStudioLlmConfig
) => aiStudioLlmService.generateStoryboardScenes(lines, flowCfg, llmCfg);
export const generateSeoMetadata = (
  topic: string,
  lines: ScriptBeatLine[],
  cfg?: AiStudioLlmConfig
) => aiStudioLlmService.generateSeoMetadata(topic, lines, cfg);
export const auditScriptQuality = (lines: ScriptBeatLine[], cfg?: AiStudioLlmConfig) =>
  aiStudioLlmService.auditScriptQuality(lines, cfg);
