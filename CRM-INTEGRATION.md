# CRM 신청 연동

`index.html`의 `crm-origin`은 CRM 운영 주소 `https://clipedu-admin.kr`입니다. 신청은 브라우저에서 `POST https://clipedu-admin.kr/api/public/education-applications`로 직접 전송되며, 랜딩(Vercel)은 신청 내용을 받지 않습니다.

## CRM 측 현황 (2026-11-10 확인)

- CRM PR #514 머지·운영 배포 완료, `education_applications` 테이블 마이그레이션 적용됨.
- CORS 허용 Origin: `https://clipedu-support.co.kr`, `https://edu-support-landing.vercel.app` (그 외 Origin은 403). `www.` 서브도메인은 허용 목록에 없음.
- 검증: 요청 본문 8KB·5초 제한, 필드 화이트리스트(추가 필드 거부), `consentVersion`은 `2026-11-10`만 허용. 동의 문구/버전을 바꾸면 CRM 검증값도 함께 바꿔야 함.
- 중복 방지: `requestId` 기준 원자적 멱등 저장(같은 내용 재전송 204, 다른 내용 409).
- 한도: 전역 60건/분, IP별 10건/10분(IP는 저장하지 않음).
- 저장 위치: CRM 서버(국내 IP 대역) 내 PostgreSQL. DB 백업도 같은 서버에 14일 보관.
- 열람: CRM 리터치팀 섹션 `SK설문조사` 탭(관리자·리터치팀만). 자동 삭제·자동 매칭 없음 — 지원금 진행 여부를 담당자가 확인한 뒤 삭제하는 운영 방식.

## 랜딩 동작

전송이 시작되면 입력을 잠급니다. 이전에 불확실한 시도가 없고 서버가 400을 반환한 경우 입력을 수정하고 새 requestId로 신청할 수 있습니다. 그 외 실패나 시간 초과 후에는 같은 내용과 requestId로만 재시도하며 이후 400도 이전 시도의 결과를 확정하지 못합니다. requestId와 내용은 페이지 메모리에만 있으므로 새로고침/닫기 후 복구되지 않습니다. 서버의 2xx 응답만 접수로 표시합니다. `crm-origin`이 비어 있거나 잘못되면 전송하지 않습니다.

## 테스트

`@playwright/test`와 Chromium을 별도로 준비한 뒤 `npx playwright test tests/submission.spec.cjs --workers=1` 실행. 테스트는 로컬 HTTP 서버와 가로챈 합성 응답만 사용하며 운영 CRM에 쓰지 않습니다.

`script.js`를 수정하면 `sha256sum script.js`의 전체 해시로 `index.html`의 `script.js?v=...` 값을 갱신하세요. 회귀 테스트가 해시 일치 여부와 이전 스크립트 캐시를 확인합니다.
