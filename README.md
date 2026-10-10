# VisioFlow

Azərbaycan dilində, cədvəldə yazılan iş axınını canlı diaqrama çevirən veb alət. Next.js və React ilə hazırlanıb; Vercel-də yerləşdirilə bilər.

## İş ardıcıllığı

1. Prosesin adını və pool sayını daxil et. Hər pool iştirakçı təşkilatı/sistemi, daxilindəki lane-lər isə rolları göstərir.
2. Addımları cədvəldə yaz: ad, element növü və icraçı. Sətirin “Təsvir və keçidlər” hissəsində biznes qaydalarını və növbəti addımları göstər.
3. XOR üçün bir yol, OR üçün bir və ya bir neçə yol, AND üçün bütün paralel yollar nəzərdə tutulur. Keçidə şərt yaz və hədəfi seç; əvvəlki addımlara dönüş də mümkündür.
4. Canlı diaqramda elementə kliklə və ya klaviatura ilə seç. Böyütmə, kiçiltmə, sürüşdürmə və ekrana sığdırma var.
5. “İzah və yoxlama” bölməsində əlaqələri yoxla və “Yüklə” menyusundan faylı seç.

## İlk versiyada olanlar

- Pool və lane-lər; başlanğıc, son, aralıq, mesaj və vaxt hadisələri.
- Tapşırıq, istifadəçi/sistem tapşırığı, alt proses, XOR/OR/AND keçidləri, sənəd və qeyd elementləri.
- Eyni pool daxilində ardıcıl axın, pool-lar arasında mesaj axını, sənəd/qeyd üçün nöqtəli əlaqə.
- Struktura əsaslanan Azərbaycan dilində izah; əlaqəsiz addımlar, olmayan hədəflər, başlanğıc/son və qərar şərtləri barədə yoxlama.
- İstifadəçinin verdiyi “Müştəri müraciətləri” nümunəsi: operator, vizaçı, aidiyyəti şəxslər, icraçılar, imtina/düzəliş dövrü, paralel ünvanlanma və QNV statusları. İmzalama nümunədə Vizaçı lane-indədir; ayrıca rol əlavə edib dəyişmək olar.
- Redaktə olunan **.vsdx**, **.svg**, layihə ehtiyat nüsxəsi **.json**, izah **.txt** ixracı; JSON importu.
- Hesabsız istifadə, brauzerdə avtomatik yadda saxlama, son dəyişiklikləri geri alma, təsdiqli “Hər şeyi sil”.

## Yadda saxlama

Məlumat serverə göndərilmir. Layihə `localStorage`-da `visioflow:v1:<id>` açarı ilə saxlanılır; URL-dəki `#<id>` həmin brauzerdə onu bərpa edir. Hash silindikdə yeni boş layihə yaranır. Eyni link başqa cihazda məlumatı bərpa etmir. Başqa cihazda davam etmək və brauzer yaddaşı təmizlənməsinə qarşı qorumaq üçün JSON yüklə.

“Hər şeyi sil” təsdiqdən sonra yalnız bu alətin yerli layihə açarlarını silir. Yeni diaqram və ya nümunə açmaq əvvəlki layihənin açarını saxlayır. Brauzer yerli yaddaşı bloklayarsa və ya yaddaş dolarsa interfeys bunu göstərir; saxlanılmamış dəyişikliklər başqa layihə açmazdan əvvəl xəbərdarlıq və JSON ehtiyat nüsxəsi ilə qorunur. Silmə uğursuz olarsa hazırkı layihə açıq qalır. Fayl oxunarkən edilən dəyişikliklər gecikmiş importla əvəz edilmir.

## Lokal inkişaf

Node.js 24 və npm istifadə et. Node versiyası `.nvmrc` və `package.json`-da göstərilib.

```sh
npm ci
npm run dev
```

Standart port 3000-dır.

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm start
```

Unit testlər proses qaydalarını, dövrlərin layout-unu, etibarsız importu və VSDX ZIP/XML strukturunu yoxlayır. Brauzer testləri redaktə, bərpa, hash sıfırlama, təsdiqli silmə və ixrac/importu yoxlayır. E2E testi `CHROMIUM_PATH` verilərsə onu, yoxdursa `/usr/bin/chromium` mövcud olduqda sistem Chromium-unu istifadə edir. Digər maşında `npx playwright install chromium` ilə brauzeri quraşdır.

## Vercel

1. [Vercel](https://vercel.com/new)-də GitHub hesabınla giriş et. Dashboard-dan **Add New → Project** seç.
2. **Import Git Repository** siyahısında `Sanan2030/Visio_generator` tap və **Import** düyməsini bas.
3. Repository görünmürsə **Configure GitHub App** vasitəsilə Vercel-ə bu repository üçün giriş ver, sonra siyahını yenilə. Repository private qala bilər.
4. Project Name üçün məsələn `visio-generator` yaz. Root Directory-ni repository kökü olaraq saxla (`./`). Layihə alt qovluqda deyil.
5. Aşağıdakı parametrləri yoxla. `vercel.json` framework, install və build əmrlərini, `package.json` isə Node versiyasını göstərir.

| Parametr | Dəyər |
| --- | --- |
| Framework Preset | **Next.js** |
| Root Directory | `./` — repository kökü |
| Node.js Version | **24.x** |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Next.js standartı; override əlavə etmə |
| Environment Variables | Bu versiya üçün əlavə etməyə ehtiyac yoxdur |

6. **Deploy** düyməsini bas. Build tamamlanıb **Ready** olduqda Vercel-in verdiyi `.vercel.app` ünvanını aç.
7. Layihənin **Settings → Git** bölməsində **Production Branch** dəyərinin `main` olduğunu yoxla. Sonrakı `main` push-ları avtomatik yeni production deploy yaradacaq.
8. Saytda **Nümunə proses** aç, bir xananı dəyiş, səhifəni yenilə və yaddaşın bərpasını yoxla. **Yüklə → Microsoft Visio** ilə `.vsdx` faylını yüklə.

Bu versiya hesab, verilənlər bazası və AI açarı tələb etmir. Deploy uğursuz olarsa **Deployment → Build Logs** bölməsini aç: Node versiyası `24.x`, repository kökü isə `./` olmalıdır.

Rəsmi sənədlər: [GitHub inteqrasiyası](https://vercel.com/docs/git/vercel-for-github), [build parametrləri](https://vercel.com/docs/deployments/configure-a-build).

## Məhdudiyyətlər və sonrakı iş

Bu, əsas BPMN elementləri ilə diaqram redaktorudur; biznes prosesini icra edən mühərrik və tam BPMN standart validatoru deyil. Alt proses vahid fiqur kimi göstərilir, iç-içə ayrıca səhifə redaktoru hələ yoxdur. Pool/lane-lər VSDX-də redaktə olunan fiqurlardır, Visio-nun xüsusi container/master-ləri deyil; pool-u hərəkət etdirmək daxilindəki elementləri birlikdə daşımır.

VSDX native fiqurlar, Unicode mətn və əlaqəli birləşdiricilərdən ibarətdir. ZIP/XML struktur testləri və LibreOffice import/conversion yoxlaması var. Microsoft Visio Desktop/Web-də açmaq, fiquru dəyişmək və birləşdiricini yoxlamaq ayrıca əl ilə qəbul sınağı tələb edir.

**Sloth AI hazırda qoşulmayıb.** İstifadə yeri və API müqaviləsi dəqiqləşəndən sonra inteqrasiya ayrıca əlavə edilə bilər. Hazırkı izah xarici AI çağırışı etmədən, cədvəlin məlumatlarından qaydalar əsasında hazırlanır.

İdxal olunan layihələr maksimum 8 pool, hər pool üçün 20 lane və ümumi 200 element ilə məhdudlaşdırılır. JSON maksimum 100 MB-dır; limit UTF-8 baytları ilə hesablanır və geniş təsvirli layihələrin ehtiyat nüsxələrini yenidən açmağa imkan verir. Brauzerin yerli yaddaş limiti ayrıca tətbiq olunur; böyük layihələrdə JSON ehtiyat nüsxəsini yüklə. Faylın strukturunun düzgünlüyü ayrıca yoxlanılır, yarımçıq layihələr import oluna bilər.
