export interface CelestialContentEntry {
  nameAr: string;
  description?: string;
  /** مسار نسبي داخل public/audio/، مثلاً '/audio/sun.mp3'. اختياري تماماً. */
  audioUrl?: string;
}

/**
 * سجل محتوى مركزي قابل للتوسعة لكل جرم/عنصر في التطبيق (نجم، كوكب، منزلة، برج...).
 * المفتاح ثابت لكل عنصر (id) بصرف النظر عن موقعه الحالي في السماء، فيمكن ربط محتوى غني
 * (وصف، تعليق صوتي، لاحقاً: صور، روابط) دون المساس بمنطق الرسم أو الإسقاط إطلاقاً.
 *
 * لإضافة عنصر جديد لاحقاً: أضف سطراً هنا بالمفتاح المناسب (انظر getContentId أدناه) وحقول
 * nameAr/description/audioUrl حسب توفرها. بطاقة التحويم في SkyCanvas.tsx تقرأ من هنا
 * تلقائياً — أي عنصر له audioUrl سيظهر بجانبه زر تشغيل بلا أي تعديل آخر في الكود.
 */
export const CELESTIAL_CONTENT: Record<string, CelestialContentEntry> = {
  sun: {
    nameAr: 'الشمس',
    description: 'نجمنا، مركز المجموعة الشمسية، يبعد عن الأرض نحو 150 مليون كم.',
  },
  moon: {
    nameAr: 'القمر',
    description: 'القمر الطبيعي الوحيد للأرض، يكمل دورة أطواره الكاملة كل نحو 29.5 يوماً.',
  },
  // مثال توضيحي فقط لطريقة ربط مقطع صوتي مستقبلاً — الملف نفسه غير موجود بعد:
  // 'star:الشعرى اليمانية': { nameAr: 'الشعرى اليمانية', audioUrl: '/audio/sirius.mp3' },
};

/** يبني مفتاح محتوى ثابتاً لكل نوع عنصر، مستقلاً عن موقعه الحالي في السماء */
export function getContentId(kind: 'sun' | 'moon' | 'planet' | 'star' | 'observer', ref: string): string {
  if (kind === 'sun' || kind === 'moon' || kind === 'observer') return kind;
  return `${kind}:${ref}`;
}

export function getContent(id: string): CelestialContentEntry | undefined {
  return CELESTIAL_CONTENT[id];
}