import type { Messages } from './en';

/** "دقيقة" after a number, by the Arabic plural rules. */
function minutesAr(count: number): string {
  if (count === 1) return 'دقيقة';
  if (count === 2) return 'دقيقتين';
  if (count <= 10) return `${count} دقائق`;
  return `${count} دقيقة`;
}

export const ar: Messages = {
  app: {
    name: 'Dental Hub CRM',
    brand: 'Dental Hub',
    tagline: 'نظام المبيعات',
    title: (page) => `${page} | Dental Hub CRM`,
  },
  common: {
    saving: 'جارٍ الحفظ...',
    invalidInput: 'البيانات المدخلة غير صحيحة.',
    minCharacters: (count) => `${count} حرفًا على الأقل.`,
  },
  language: {
    switchTo: 'English',
    switchToLabel: 'التحويل إلى الإنجليزية',
  },
  roles: {
    ADMIN: 'مدير النظام',
    SALES_MANAGER: 'مدير المبيعات',
    SALES_REP: 'مندوب مبيعات',
  },
  nav: {
    workspace: 'مساحة العمل',
    settings: 'الإعدادات',
    crmNavigation: 'قائمة النظام',
    settingsNavigation: 'قائمة الإعدادات',
    comingSoon: 'قريبًا',
    soon: 'قريبًا',
    home: 'الرئيسية',
    leads: 'العملاء المحتملون',
    opportunities: 'الفرص',
    customers: 'العملاء',
    followUps: 'المتابعات',
    pipeline: 'مسار المبيعات',
    quotations: 'عروض الأسعار',
    reports: 'التقارير',
    team: 'الفريق',
    users: 'المستخدمون',
    password: 'كلمة المرور',
    openMenu: 'فتح القائمة',
    closeMenu: 'إغلاق القائمة',
    navigation: 'التنقل',
    signOut: 'خروج',
    signingOut: 'جارٍ تسجيل الخروج...',
  },
  login: {
    pageTitle: 'تسجيل الدخول',
    subtitle: 'سجّل الدخول للمتابعة',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signIn: 'تسجيل الدخول',
    signingIn: 'جارٍ تسجيل الدخول...',
    invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    tooManyAttempts: (minutes) =>
      `محاولات دخول كثيرة. حاول مرة أخرى بعد ${minutesAr(minutes)}.`,
  },
  forbidden: {
    pageTitle: 'غير مسموح',
    heading: 'ليست لديك صلاحية لفتح هذه الصفحة',
    body: (role) =>
      `دورك (${role}) لا يسمح بعرضها. لو تعتقد أن هذا خطأ، تواصل مع مدير النظام.`,
    backHome: 'العودة إلى الرئيسية',
  },
  password: {
    pageTitle: 'كلمة المرور',
    eyebrow: 'الإعدادات',
    heading: 'تغيير كلمة المرور',
    description: (email) =>
      `مسجّل الدخول بحساب ${email}. تغيير كلمة المرور يسجّل خروجك من كل الأجهزة الأخرى.`,
    current: 'كلمة المرور الحالية',
    new: 'كلمة المرور الجديدة',
    confirm: 'تأكيد كلمة المرور الجديدة',
    submit: 'تغيير كلمة المرور',
    enterCurrent: 'أدخل كلمة المرور الحالية.',
    newTooShort: (count) => `كلمة المرور الجديدة يجب ألا تقل عن ${count} حرفًا.`,
    mismatch: 'كلمتا المرور الجديدتان غير متطابقتين.',
    sameAsCurrent: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
    currentIncorrect: 'كلمة المرور الحالية غير صحيحة.',
    changed: 'تم تغيير كلمة المرور، وتم تسجيل خروجك من كل الأجهزة الأخرى.',
  },
  users: {
    pageTitle: 'المستخدمون',
    eyebrow: 'الإعدادات',
    heading: 'المستخدمون',
    description:
      'حسابات فريق Dental Hub. أضف الموظفين، وغيّر أدوارهم، وعيّن كلمة مرور جديدة لمن نسيها، وأوقف حساب من يترك العمل.',
    you: 'أنت',
    inactive: 'موقوف',
    addTitle: 'إضافة مستخدم',
    displayName: 'الاسم',
    email: 'البريد الإلكتروني',
    initialPassword: 'كلمة المرور المبدئية',
    role: 'الدور',
    create: 'إنشاء المستخدم',
    creating: 'جارٍ الإنشاء...',
    roleFor: (name) => `دور ${name}`,
    saveRole: 'حفظ الدور',
    activate: 'تفعيل',
    deactivate: 'إيقاف',
    resetPassword: 'تعيين كلمة مرور جديدة',
    newPasswordFor: (name) => `كلمة المرور الجديدة لـ ${name}`,
    newPasswordPlaceholder: (count) => `كلمة مرور جديدة (${count} حرفًا أو أكثر)`,
    setPassword: 'حفظ كلمة المرور',
    created: (name) => `تم إنشاء حساب ${name}.`,
    roleUpdated: (name) => `تم تحديث دور ${name}.`,
    activated: (name) => `تم تفعيل حساب ${name}.`,
    deactivated: (name) => `تم إيقاف حساب ${name}.`,
    passwordReset: (name) =>
      `تم تعيين كلمة مرور جديدة لـ ${name}، وتم إنهاء كل الجلسات المفتوحة لهذا الحساب.`,
    ownPassword: 'غيّر كلمة المرور الخاصة بك من الإعدادات ← كلمة المرور.',
    displayNameRequired: 'الاسم مطلوب.',
    invalidEmail: 'أدخل بريدًا إلكترونيًا صحيحًا.',
    passwordTooShort: (count) => `كلمة المرور يجب ألا تقل عن ${count} حرفًا.`,
    lastActiveAdmin: 'هذا آخر مدير نظام نشط. فعّل مدير نظام آخر أو رقِّ مستخدمًا إلى مدير نظام أولًا.',
    duplicateEmail: 'هذا البريد الإلكتروني مستخدم بالفعل.',
  },
};
