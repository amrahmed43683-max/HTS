import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ROLE_FRAMES } from './data/roleFrames';
import { htsStorage } from './storage/htsIndexedDb';
import {
  loadPreferences,
  savePreferences,
} from './storage/preferences';
import { ROLE_IDS, RoleId, StorageStatusInfo } from './storage/types';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

const ROLE_OPTIONS: Array<{ value: RoleId; label: string }> = [
  { value: 'doctor', label: '👨‍⚕️ الطبيب' },
  { value: 'patient', label: '🧑‍🦽 المريض' },
  { value: 'pharmacy', label: '💊 الصيدلية' },
  { value: 'lab', label: '🧪 التحاليل' },
  { value: 'insurance', label: '🛡️ التأمين' },
  { value: 'hospital', label: '🏥 المستشفى' },
];

const ROLE_NAMES_AR: Record<RoleId, string> = {
  doctor: 'الطبيب',
  patient: 'المريض',
  pharmacy: 'الصيدلية',
  lab: 'التحاليل',
  insurance: 'التأمين',
  hospital: 'المستشفى',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'غير متاح';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateAr(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG');
  } catch {
    return iso;
  }
}

export default function App() {
  const initialPrefs = useRef(loadPreferences());

  const [dbReady, setDbReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(
    initialPrefs.current.isLoggedIn
  );
  const [activeRole, setActiveRole] = useState<RoleId>(
    initialPrefs.current.activeRole
  );
  const [loadedRoles, setLoadedRoles] = useState<RoleId[]>(() =>
    initialPrefs.current.isLoggedIn ? [initialPrefs.current.activeRole] : []
  );

  // Login form states
  const [loginUser, setLoginUser] = useState<string>(
    initialPrefs.current.lastUsername || ''
  );
  const [loginPass, setLoginPass] = useState<string>('');
  const [loginRole, setLoginRole] = useState<RoleId>(
    initialPrefs.current.activeRole
  );
  const [loginError, setLoginError] = useState<string>('');

  // Storage status, backup modal, toasts
  const [storageStatus, setStorageStatus] = useState<StorageStatusInfo>(() =>
    htsStorage.getStatus()
  );
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [confirmResetPending, setConfirmResetPending] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastCounter = useRef(1);

  const pushToast = useCallback(
    (message: string, type: ToastItem['type'] = 'info') => {
      const id = toastCounter.current++;
      setToasts((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    const unsub = htsStorage.subscribe((ev) => {
      if (!mounted) return;
      setStorageStatus(htsStorage.getStatus());
      if (ev.type === 'error') {
        pushToast(ev.message, 'error');
      }
    });

    void htsStorage.init().then((status) => {
      if (!mounted) return;
      setStorageStatus(status);
      setDbReady(true);
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, [pushToast]);

  const ensureRoleLoaded = useCallback((role: RoleId) => {
    setLoadedRoles((prev) => (prev.includes(role) ? prev : [...prev, role]));
  }, []);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass.trim()) {
      setLoginError('من فضلك أدخل اسم المستخدم وكلمة المرور.');
      return;
    }

    setLoginError('');
    const selectedRole = loginRole;
    savePreferences({
      isLoggedIn: true,
      activeRole: selectedRole,
      lastUsername: loginUser.trim(),
    });
    setActiveRole(selectedRole);
    ensureRoleLoaded(selectedRole);
    setIsLoggedIn(true);
    setLoginPass('');
  };

  const handleLogout = () => {
    savePreferences({ isLoggedIn: false });
    setIsLoggedIn(false);
    setLoginPass('');
    setLoginError('');
  };

  const handleExportJson = async () => {
    setBusyAction(true);
    setModalError(null);
    try {
      const result = await htsStorage.exportBackupJson();
      if (!result.ok || !result.jsonString || !result.filename) {
        const errMsg = result.error || 'تعذر تصدير النسخة الاحتياطية.';
        setModalError(errMsg);
        pushToast(errMsg, 'error');
        return;
      }

      const blob = new Blob([result.jsonString], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setStorageStatus(htsStorage.getStatus());
      pushToast(`✓ تم تصدير النسخة الاحتياطية (${result.filename})`, 'success');
    } catch (err) {
      const msg =
        err instanceof Error
          ? `خطأ أثناء التصدير: ${err.message}`
          : 'حدث خطأ غير متوقع أثناء تصدير النسخة الاحتياطية.';
      setModalError(msg);
      pushToast(msg, 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const triggerImportPicker = () => {
    setModalError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusyAction(true);
    setModalError(null);

    try {
      if (file.size === 0) {
        const msg = 'الملف المحدد فارغ (0 بايت).';
        setModalError(msg);
        pushToast(msg, 'error');
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        const msg = 'حجم ملف النسخة الاحتياطية يتجاوز الحد المسموح (25 MB).';
        setModalError(msg);
        pushToast(msg, 'error');
        return;
      }

      const rawText = await file.text();
      const res = await htsStorage.importBackupJson(rawText);
      if (!res.ok) {
        const msg = res.error || 'فشل التحقق من صحة النسخة الاحتياطية.';
        setModalError(msg);
        pushToast(msg, 'error');
        return;
      }

      if (res.restoredRole) {
        setActiveRole(res.restoredRole);
        setLoginRole(res.restoredRole);
        if (isLoggedIn) {
          ensureRoleLoaded(res.restoredRole);
        }
      }
      setStorageStatus(htsStorage.getStatus());
      pushToast(
        '✓ تم استيراد النسخة الاحتياطية والتحقق منها وحفظها في IndexedDB بنجاح.',
        'success'
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? `تعذر قراءة ملف النسخة الاحتياطية: ${err.message}`
          : 'تعذر قراءة الملف المحدد.';
      setModalError(msg);
      pushToast(msg, 'error');
    } finally {
      setBusyAction(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRequestPersist = async () => {
    setModalError(null);
    const granted = await htsStorage.requestPersistentStorage();
    setStorageStatus(htsStorage.getStatus());
    if (granted === true) {
      pushToast('✓ تم تفعيل التخزين الدائم للمتصفح بنجاح.', 'success');
    } else if (granted === false) {
      pushToast(
        'لم يمنح المتصفح صلاحية التخزين الدائم حالياً؛ تبقى بيانات IndexedDB محفوظة محلياً.',
        'warning'
      );
    } else {
      pushToast('ميزة Storage Persist غير مدعومة في هذا المتصفح.', 'warning');
    }
  };

  const handleResetDemo = async () => {
    setBusyAction(true);
    setModalError(null);
    try {
      const res = await htsStorage.resetDemoData();
      if (!res.ok) {
        const msg = res.error || 'تعذر إعادة تعيين البيانات التجريبية.';
        setModalError(msg);
        pushToast(msg, 'error');
        return;
      }
      setConfirmResetPending(false);
      setStorageStatus(htsStorage.getStatus());
      pushToast(
        '✓ تمت إعادة تعيين البيانات التجريبية الافتراضية في IndexedDB.',
        'success'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const persistLabel =
    storageStatus.persisted === true
      ? 'تخزين دائم ✓'
      : storageStatus.persisted === false
        ? 'تخزين محلي'
        : 'IndexedDB محلي';

  return (
    <>
      <input
        ref={fileInputRef}
        id="htsBackupFileInput"
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFileChange}
      />

      {/* Toast Notifications */}
      <div className="hts-toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`hts-toast ${toast.type}`} role="status">
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() =>
                setToasts((prev) => prev.filter((t) => t.id !== toast.id))
              }
              style={{
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                color: 'inherit',
                fontWeight: 700,
              }}
              aria-label="إغلاق التنبيه"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Login Page */}
      {!isLoggedIn && (
        <div id="loginPage" className="login-page">
          <div className="login-card">
            <div className="login-logo">🏥</div>
            <h1>تسجيل الدخول</h1>
            <p>المنصة الصحية المتكاملة</p>
            <form id="loginForm" onSubmit={handleLoginSubmit}>
              <div className="login-group">
                <label htmlFor="loginUser">البريد الإلكتروني أو اسم المستخدم</label>
                <input
                  id="loginUser"
                  type="text"
                  placeholder="أدخل اسم المستخدم"
                  autoComplete="username"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                />
              </div>
              <div className="login-group">
                <label htmlFor="loginPass">كلمة المرور</label>
                <input
                  id="loginPass"
                  type="password"
                  placeholder="أدخل كلمة المرور"
                  autoComplete="current-password"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                />
              </div>
              <div className="login-group">
                <label htmlFor="loginRole">نوع الحساب</label>
                <select
                  id="loginRole"
                  value={loginRole}
                  onChange={(e) => setLoginRole(e.target.value as RoleId)}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button className="login-btn" type="submit">
                دخول إلى المنصة
              </button>
              {loginError && (
                <div id="loginError" className="login-error">
                  {loginError}
                </div>
              )}
            </form>
            <p className="login-note">
              يتم حفظ جميع بيانات العرض التجريبي محلياً داخل متصفحك عبر IndexedDB دون أي خادم خارجي.
            </p>
            <div className="login-backup-row">
              <button
                type="button"
                className="login-backup-btn"
                id="loginImportBackupBtn"
                onClick={triggerImportPicker}
                disabled={busyAction}
              >
                ⬆️ استيراد نسخة JSON
              </button>
              <button
                type="button"
                className="login-backup-btn"
                id="loginStorageInfoBtn"
                onClick={() => {
                  setModalError(null);
                  setStorageModalOpen(true);
                }}
              >
                🗄️ حالة قاعدة البيانات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* App Shell */}
      <div
        className="shell"
        id="appShell"
        style={{ display: isLoggedIn ? 'flex' : 'none' }}
      >
        <header className="top" id="mainHeader">
          <div className="brand">🏥 المنصة الصحية المتكاملة</div>
          <div className="header-actions">
            <button
              type="button"
              id="storageStatusBtn"
              className="storage-pill-btn"
              onClick={() => {
                setModalError(null);
                setConfirmResetPending(false);
                setStorageModalOpen(true);
              }}
              title="حالة التخزين المحلي وإدارة النسخ الاحتياطي"
            >
              <span
                className={`storage-dot ${
                  storageStatus.lastError
                    ? 'error'
                    : storageStatus.persisted
                      ? 'persisted'
                      : ''
                }`}
              />
              <span>🗄️ {persistLabel}</span>
            </button>

            <button
              type="button"
              id="exportBackupBtn"
              className="header-tool-btn"
              onClick={handleExportJson}
              disabled={busyAction || !dbReady}
            >
              ⬇️ تصدير JSON
            </button>

            <button
              type="button"
              id="importBackupBtn"
              className="header-tool-btn"
              onClick={triggerImportPicker}
              disabled={busyAction || !dbReady}
            >
              ⬆️ استيراد JSON
            </button>

            <button
              className="logout-btn"
              id="logoutBtn"
              type="button"
              onClick={handleLogout}
            >
              تسجيل الخروج
            </button>
          </div>
        </header>

        <main className="workspace">
          {dbReady &&
            ROLE_IDS.map((role) => {
              const isMounted = loadedRoles.includes(role);
              const isActive = isLoggedIn && activeRole === role;
              return (
                <iframe
                  key={role}
                  id={`frame-${role}`}
                  className={isActive ? 'app-frame active' : 'app-frame'}
                  title={ROLE_NAMES_AR[role]}
                  srcDoc={isMounted ? ROLE_FRAMES[role] : undefined}
                />
              );
            })}
        </main>
      </div>

      {/* Local Storage & Backup Modal */}
      {storageModalOpen && (
        <div
          className="hts-modal-backdrop"
          id="storageModal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStorageModalOpen(false);
          }}
        >
          <div className="hts-modal-card" role="dialog" aria-modal="true">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '12px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                🗄️ إدارة قاعدة البيانات المحلية والنسخ الاحتياطي
              </h2>
              <button
                type="button"
                onClick={() => setStorageModalOpen(false)}
                style={{
                  border: 0,
                  background: '#f1f5f9',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div
                id="backupModalError"
                style={{
                  background: '#fee2e2',
                  border: '1px solid #fca5a5',
                  color: '#991b1b',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  marginBottom: '14px',
                  fontSize: '13px',
                }}
              >
                ⚠️ {modalError}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  محرك قاعدة البيانات
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '4px' }}>
                  {storageStatus.indexedDbSupported
                    ? `IndexedDB (${storageStatus.dbName})`
                    : 'غير مدعوم'}
                </div>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  التخزين الدائم (Persist API)
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '4px' }}>
                  {storageStatus.persisted === true
                    ? 'مُفعّل ✓'
                    : storageStatus.persistSupported
                      ? 'متاح (اختياري)'
                      : 'غير مدعوم'}
                </div>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  المساحة المستخدمة
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px', marginTop: '4px' }}>
                  {formatBytes(storageStatus.usageBytes)}
                </div>
              </div>
            </div>

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '12.5px',
                lineHeight: 1.7,
              }}
            >
              <div>
                <strong>تاريخ التهيئة التلقائية:</strong>{' '}
                {formatDateAr(storageStatus.initializedAt)}
              </div>
              <div>
                <strong>آخر حفظ للبيانات:</strong>{' '}
                {formatDateAr(storageStatus.lastUpdatedAt)}
              </div>
              <div>
                <strong>آخر نسخة احتياطية:</strong>{' '}
                {formatDateAr(storageStatus.lastBackupAt)}
              </div>
              <div style={{ marginTop: '6px', color: '#475569' }}>
                <strong>توزيع السجلات في IndexedDB:</strong>{' '}
                {ROLE_IDS.map(
                  (r) => `${ROLE_NAMES_AR[r]} (${storageStatus.recordCounts[r]})`
                ).join(' • ')}{' '}
                • الطلبات المشتركة ({storageStatus.sharedCount})
              </div>
              <div style={{ marginTop: '4px', color: '#64748b', fontSize: '11.5px' }}>
                يُستخدم Local Storage للتفضيلات البسيطة فقط (نوع الحساب والصفحة الأخيرة).
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <button
                type="button"
                onClick={handleExportJson}
                disabled={busyAction}
                style={{
                  border: 0,
                  background: '#0ea5e9',
                  color: '#fff',
                  padding: '10px 14px',
                  borderRadius: '9px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⬇️ تصدير نسخة JSON
              </button>

              <button
                type="button"
                onClick={triggerImportPicker}
                disabled={busyAction}
                style={{
                  border: 0,
                  background: '#10b981',
                  color: '#fff',
                  padding: '10px 14px',
                  borderRadius: '9px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⬆️ استيراد نسخة JSON
              </button>

              {storageStatus.persistSupported &&
                storageStatus.persisted !== true && (
                  <button
                    type="button"
                    onClick={handleRequestPersist}
                    disabled={busyAction}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      color: '#0f172a',
                      padding: '10px 14px',
                      borderRadius: '9px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🔒 طلب التخزين الدائم
                  </button>
                )}

              {!confirmResetPending ? (
                <button
                  type="button"
                  id="resetDemoBtn"
                  onClick={() => setConfirmResetPending(true)}
                  disabled={busyAction}
                  style={{
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#991b1b',
                    padding: '10px 14px',
                    borderRadius: '9px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginRight: 'auto',
                  }}
                >
                  ↺ إعادة تعيين البيانات التجريبية
                </button>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginRight: 'auto',
                  }}
                >
                  <button
                    type="button"
                    id="confirmResetDemoBtn"
                    onClick={handleResetDemo}
                    disabled={busyAction}
                    style={{
                      border: 0,
                      background: '#dc2626',
                      color: '#fff',
                      padding: '10px 12px',
                      borderRadius: '9px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    تأكيد إعادة التعيين
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmResetPending(false)}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      color: '#334155',
                      padding: '10px 12px',
                      borderRadius: '9px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
