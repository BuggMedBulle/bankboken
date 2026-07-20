# Split Happens

Split Happens lägger till riktiga användarkonton och flera separata delningar. Den befintliga Helo/Halvis-versionen i `bankboken/` påverkas inte.

## Firebase-inställningar

1. Öppna Firebase Console och projektet `hh-bankboken`.
2. Gå till **Authentication → Sign-in method** och aktivera **Email/Password**.
3. Gå till **Firestore Database → Rules**.
4. Ersätt reglerna med innehållet i `firestore.rules` och publicera dem.

Reglerna låter tills vidare den gamla toppnivåsamlingen `entries` fungera som tidigare. Det gör att nuvarande Helo/Halvis-app fortsätter fungera under testperioden. När den datan har migrerats kan kompatibilitetsregeln tas bort.

## Så fungerar det

- Varje person skapar ett eget konto med namn, e-post, lösenord och Swishnummer.
- Den första personen skapar en Bankbok och skickar dess inbjudningskod till den andra.
- Den andra personen går med via koden.
- Varje Bankbok kan ha högst två personer.
- Utgifter ligger under `bankbooks/{bankbookId}/entries` och synkas i realtid endast mellan medlemmarna.

## Viktigt före produktionspublicering

Testa v2 på localhost med två olika konton, gärna i ett vanligt och ett privat webbläsarfönster. Publicera inte mappen som ersättning för nuvarande `bankboken/` förrän konton, regler, inbjudan och synk har verifierats.
