# EVGO mobile app (Flutter)

iOS and Android customer app: Home (trips timeline), Travel (bus), Charge (EV), Wallet.

Platform folders (`android/`, `ios/`) are generated, not committed by hand:

```sh
cd apps/mobile
flutter create --org in.evgo --project-name evgo --platforms=android,ios .
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001/v1   # Android emulator
```

The API client in `lib/api/` is hand-written for now; it will be generated from
`packages/api-contract/openapi.yaml` once the contract stabilises.
