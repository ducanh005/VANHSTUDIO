import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Languages,
  Mic,
  Rocket,
  Sparkles,
  Subtitles,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react';

/**
 * Popup hướng dẫn luồng xử lý cho người dùng mới:
 * - Tự hiện lần đầu mở app (lưu qua setting onboardingCompleted)
 * - Nút dấu hỏi trên thanh công cụ mở lại bất cứ lúc nào
 * - Wizard 5 bước: chào mừng → thêm video → tạo phụ đề → dịch → lồng tiếng & xuất
 */

interface GuideStep {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  bullets: React.ReactNode[];
  hint?: React.ReactNode;
}

const STEPS: GuideStep[] = [
  {
    icon: Sparkles,
    title: 'Chào mừng đến với VanhStudio!',
    description:
      'Studio phụ đề & lồng tiếng AI chạy trực tiếp trên máy của bạn — biến video nước ngoài thành phụ đề tiếng Việt và giọng lồng tiếng tự nhiên.',
    bullets: [
      <>
        Quy trình gồm 5 bước: <strong className="text-text">Thêm video → Tạo phụ đề → Dịch &amp; hiệu đính → Lồng tiếng → Xuất video</strong>.
      </>,
      <>
        Mỗi bước chạy được riêng lẻ, hoặc bấm <strong className="text-accent">"Chạy cả quy trình"</strong> để tự động hết.
      </>,
      <>
        Video/audio xử lý hoàn toàn trên máy — chỉ nội dung chữ được gửi Gemini để dịch.
      </>,
    ],
    hint: (
      <>
        Hướng dẫn này luôn mở lại được bằng nút dấu hỏi <strong className="text-text">(?)</strong> trên thanh công cụ phía trên.
      </>
    ),
  },
  {
    icon: UploadCloud,
    title: 'Bước 1 — Thêm video cần xử lý',
    description: 'Mỗi file bạn thêm là một "tác vụ" hiển thị ở Trang chủ — xử lý bao nhiêu video cũng được.',
    bullets: [
      <>Kéo thả file video/audio thẳng vào khung ở Trang chủ.</>,
      <>Bấm <strong className="text-text">"Thêm tác vụ mới"</strong> để duyệt file từ máy tính.</>,
      <>Dán link TikTok/YouTube vào ô link — app tự tải về làm tác vụ.</>,
    ],
    hint: (
      <>
        Thêm nhiều tác vụ rồi bấm <strong className="text-text">"Chạy batch"</strong> để xử lý hàng loạt — tối đa 2 tác vụ chạy song song.
      </>
    ),
  },
  {
    icon: Subtitles,
    title: 'Bước 2 — Tạo phụ đề (.srt)',
    description: 'Video của bạn có tiếng nói hay phụ đề in sẵn trong khung hình? App xử lý được cả hai:',
    bullets: [
      <>
        <strong className="text-text">"Bắt đầu phiên âm"</strong> — Whisper nghe audio và viết phụ đề (máy yếu nên chọn model tiny/base).
      </>,
      <>
        <strong className="text-text">"Quét OCR"</strong> — đọc phụ đề đã ghẽ cứng trong khung hình (hardsub) bằng Tesseract.
      </>,
      <>
        <strong className="text-text">"Nhập SRT"</strong> — đã có sẵn file phụ đề? Nhập vào và bỏ qua bước này.
      </>,
    ],
    hint: (
      <>
        Tab <strong className="text-text">"Phụ đề &amp; ASR"</strong> là nơi làm việc chính của bước này. Sau khi có phụ đề, sửa từng câu ở tab <strong className="text-text">"Hiệu đính"</strong>.
      </>
    ),
  },
  {
    icon: Languages,
    title: 'Bước 3 — Dịch & hiệu đính bằng AI',
    description: 'Dịch sang tiếng Việt (hoặc Anh/Nhật/Hàn/Trung) giữ nguyên ngữ cảnh giữa các câu thoại.',
    bullets: [
      <>
        Nhập <strong className="text-text">Gemini API key</strong> miễn phí ở Cài đặt — lấy tại aistudio.google.com.
      </>,
      <>
        Sửa câu trong tab <strong className="text-text">"Hiệu đính"</strong> — nút đũa thần gọi AI sửa chính tả, ngữ pháp từng câu.
      </>,
      <>
        Lưu <strong className="text-text">Bảng thuật ngữ + cách xưng hô</strong> ở Cài đặt để tên riêng, thuật ngữ nhất quán suốt video.
      </>,
    ],
    hint: (
      <>
        Bật <strong className="text-text">"Tự động dịch sau khi phiên âm"</strong> trong Cài đặt để bỏ hẳn bước dịch thủ công.
      </>
    ),
  },
  {
    icon: Mic,
    title: 'Bước 4 & 5 — Lồng tiếng và xuất video',
    description: 'Đưa giọng đọc tiếng Việt vào video và xuất bản hoàn chỉnh.',
    bullets: [
      <>
        Tạo giọng đọc bằng <strong className="text-text">TikTok TTS</strong> với giọng nam, nữ tiếng Việt tự nhiên và ~80 giọng đa ngôn ngữ.
      </>,
      <>
        Gán giọng riêng cho từng câu thoại, tuỳ chỉnh tốc độ đọc, nghe thử trực tiếp trước khi tạo.
      </>,
      <>
        Ghép audio vào video rồi xuất <strong className="text-text">Hardsub</strong> (ghi cứng phụ đề) hoặc <strong className="text-text">Softsub</strong> ở tab "Xuất video".
      </>,
    ],
    hint: (
      <>
        Nút ⚡ <strong className="text-text">"Chạy cả quy trình"</strong> tự chạy mọi bước còn thiếu: phiên âm → dịch → lồng tiếng → ghép video. Đưa máy chạy nền rồi quay lại nhận kết quả!
      </>
    ),
  },
];

type Props = {
  open: boolean;
  /** Đóng popup — dontShowAgain = true thì không tự hiện ở lần khởi động sau */
  onClose: (dontShowAgain: boolean) => void;
};

export default function OnboardingModal({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  // Mở lại từ đầu mỗi lần hiện
  useEffect(() => {
    if (open) {
      setStep(0);
      setDontShowAgain(true);
    }
  }, [open]);

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose(dontShowAgain);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] w-[620px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-surface outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 text-text">
          {/* Thanh tiêu đề */}
          <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 border border-border text-accent">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-text">
                  Hướng dẫn VanhStudio
                </Dialog.Title>
                <Dialog.Description className="text-[11px] text-text-muted">
                  Quy trình phụ đề &amp; lồng tiếng trong 5 bước — dành cho người dùng mới
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                title="Đóng (Esc)"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-text-muted transition hover:bg-surface-3 hover:text-text cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Nội dung bước hiện tại */}
          <div className="min-h-[300px] px-6 py-5">
            <div className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 border border-border text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-text">{current.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                  {current.description}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {current.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-text-muted">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <span className="leading-relaxed">{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {current.hint && (
              <div className="mt-5 flex items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p className="text-[11px] leading-relaxed text-text-muted">{current.hint}</p>
              </div>
            )}
          </div>

          {/* Chân: không hiện lại + điều hướng */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3.5">
            <label className="flex cursor-pointer select-none items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="h-3.5 w-3.5 rounded-[4px] border-border bg-surface-2 text-accent focus:ring-0"
              />
              Không hiện lại khi khởi động app
            </label>

            <div className="flex items-center gap-3">
              {/* Chấm chỉ báo bước */}
              <div className="flex items-center gap-1.5">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStep(i)}
                    title={`Bước ${i + 1}`}
                    className={[
                      'h-1.5 rounded-full transition-all cursor-pointer',
                      i === step
                        ? 'w-4 bg-accent'
                        : i < step
                          ? 'w-1.5 bg-accent/40'
                          : 'w-1.5 bg-surface-3 hover:bg-border-strong',
                    ].join(' ')}
                  />
                ))}
              </div>

              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text transition hover:bg-surface-3 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Trước</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => (isLast ? onClose(dontShowAgain) : setStep(step + 1))}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition cursor-pointer"
              >
                {isLast ? (
                  <>
                    <Rocket className="h-3.5 w-3.5" />
                    <span>Bắt đầu ngay!</span>
                  </>
                ) : (
                  <>
                    <span>Tiếp theo</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
