// وحدات القياس الفلكية القياسية لتفادي أخطاء التحويل بين الأنظمة
export type Degrees = number; // 0..360 أو -90..90 حسب السياق
export type Hours = number; // مطلع مستقيم 0..24
export type JulianDay = number;

/** إحداثيات استوائية: المطلع المستقيم (RA) بالساعات، والميل (Dec) بالدرجات */
export interface EquatorialCoordinates {
  rightAscensionHours: Hours;
  declinationDeg: Degrees;
}

/** إحداثيات أفقية محلية: السمت (Az، من الشمال باتجاه الشرق) والارتفاع (Alt) */
export interface HorizontalCoordinates {
  azimuthDeg: Degrees;
  altitudeDeg: Degrees;
}

/** إحداثيات بروجية: خط الطول (لامدا) وخط العرض (بيتا) */
export interface EclipticCoordinates {
  longitudeDeg: Degrees;
  latitudeDeg: Degrees;
}

export interface ObserverLocation {
  latitudeDeg: Degrees; // شمالاً موجب
  longitudeDeg: Degrees; // شرقاً موجب
  elevationM: number;
}

export type PlanetName =
  | 'Mercury'
  | 'Venus'
  | 'Mars'
  | 'Jupiter'
  | 'Saturn'
  | 'Uranus'
  | 'Neptune';

/** نقطة شاشة ثنائية الأبعاد بعد الإسقاط، مع بيانات مرئية إضافية */
export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean; // ضمن حدود اللوحة (المسافة القطبية منطقية)
  aboveHorizon: boolean; // فوق الأفق الحقيقي للمراقب
}

export interface CelestialBodyState {
  name: string;
  equatorial: EquatorialCoordinates;
  horizontal: HorizontalCoordinates;
  ecliptic?: EclipticCoordinates;
  magnitude?: number;
  angularSizeDeg?: number; // القطر الظاهري (للقمر أساساً)
  phaseFraction?: number; // نسبة الإضاءة (للقمر)
  phaseAngleDeg?: number; // زاوية الطور (لتحديد اتجاه الهلال)
}
