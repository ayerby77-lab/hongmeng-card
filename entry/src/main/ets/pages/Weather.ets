import { WEATHER_PROVINCES, WeatherProvince, WeatherCity } from '../model/WeatherCities';
import { WeatherReport, ForecastDay, weatherText, windLevel } from '../model/Weather';
import { WeatherService } from '../service/WeatherService';

@Entry
@Component
struct Weather {
  @State private provinceIndex: number = 0;
  @State private cityIndex: number = 0;
  @State private loading: boolean = false;
  @State private error: string = '';
  @State private report: WeatherReport | undefined = undefined;
  private service: WeatherService = new WeatherService();
  private requestId: number = 0;
  private active: boolean = false;
  private green: string = '#214E45';

  onPageShow(): void {
    this.active = true;
    if (!this.report) {
      this.load();
    }
  }

  onPageHide(): void {
    this.active = false;
    this.requestId++;
    this.service.cancel();
    this.loading = false;
  }

  aboutToDisappear(): void {
    this.active = false;
    this.requestId++;
    this.service.cancel();
  }

  private city(): WeatherCity {
    return WEATHER_PROVINCES[this.provinceIndex].cities[this.cityIndex];
  }

  private provinceOptions(): SelectOption[] {
    return WEATHER_PROVINCES.map((province: WeatherProvince): SelectOption => {
      return { value: province.name };
    });
  }

  private cityOptions(): SelectOption[] {
    return WEATHER_PROVINCES[this.provinceIndex].cities.map((city: WeatherCity): SelectOption => {
      return { value: city.name };
    });
  }

  private async load(): Promise<void> {
    const id = ++this.requestId;
    this.service.cancel();
    this.loading = true;
    this.error = '';
    this.report = undefined;
    const city = this.city();
    try {
      const report = await this.service.fetch(city.latitude, city.longitude);
      if (this.active && id === this.requestId) {
        this.report = report;
      }
    } catch (error) {
      if (this.active && id === this.requestId) {
        this.error = (error as Error).message || '天气获取失败，请稍后重试。';
      }
    } finally {
      if (this.active && id === this.requestId) {
        this.loading = false;
      }
    }
  }

  @Builder
  private Metric(label: string, value: string) {
    Column({ space: 6 }) {
      Text(label).fontSize(12).fontColor('#D3E2DA')
      Text(value).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#FFFFFF')
    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private Conditions(report: WeatherReport) {
    Column({ space: 16 }) {
      Text(this.city().name).fontSize(24).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      Text(report.temperature.toFixed(1) + '°C').fontSize(54).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      Text(weatherText(report.code)).fontSize(21).fontColor('#E6D7B5')
      Row({ space: 12 }) {
        this.Metric('相对湿度', report.humidity.toFixed(0) + '%')
        this.Metric('风力', windLevel(report.windSpeed).toString() + '级')
        this.Metric('风速', report.windSpeed.toFixed(1) + ' km/h')
      }.width('100%')
      Text('风向 ' + report.windDirection.toFixed(0) + '° · 北风为 0°，顺时针计')
        .fontSize(12).fontColor('#D3E2DA')
      Text('数据时间 ' + report.time.replace('T', ' ') + '（北京时间）')
        .fontSize(12).fontColor('#D3E2DA')
    }.width('100%').padding(22).alignItems(HorizontalAlign.Start)
      .backgroundColor(this.green).borderRadius(22)
    Text('七日天气 · 含今天').fontSize(20).fontWeight(FontWeight.Bold)
      .fontColor(this.green).width('100%').margin({ top: 24, bottom: 12 })
    ForEach(report.days, (day: ForecastDay) => {
      Column({ space: 10 }) {
        Row() {
          Text(day.date).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.green)
          Blank()
          Text(day.min.toFixed(0) + '° / ' + day.max.toFixed(0) + '°').fontSize(17).fontColor(this.green)
        }.width('100%')
        Row() {
          Text(weatherText(day.code)).fontSize(14).fontColor('#707D76')
          Blank()
          Text('降水概率 ' + day.rainProbability.toFixed(0) + '%').fontSize(12).fontColor('#707D76')
        }.width('100%')
      }.padding(18).width('100%').backgroundColor('#FFFFFF').borderRadius(16).margin({ bottom: 10 })
    }, (day: ForecastDay) => day.date)
    Text('数据来源：Open-Meteo · CC BY 4.0\n当前天气为模型估算，预报随数据更新；坐标为所选城市或地区的代表点。')
      .fontSize(12).fontColor('#707D76').lineHeight(20).width('100%').margin({ top: 8 })
  }

  build() {
    Scroll() {
      Column() {
        Row() {
          Column({ space: 6 }) {
            Text('天气预报').fontSize(30).fontWeight(FontWeight.Bold).fontColor(this.green)
            Text('出发前，看看城市的天气。').fontSize(13).fontColor('#707D76')
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          Button('返回').backgroundColor('#E6EAE3').fontColor(this.green)
            .onClick(() => this.getUIContext().getRouter().back())
        }.width('100%').padding({ top: 20, bottom: 24 })
        Column({ space: 12 }) {
          Text('选择省份 / 地区').fontSize(13).fontColor('#707D76').width('100%')
          Select(this.provinceOptions()).selected(this.provinceIndex)
            .value(WEATHER_PROVINCES[this.provinceIndex].name).width('100%')
            .onSelect((index: number) => {
              this.provinceIndex = index;
              this.cityIndex = 0;
              this.load();
            })
          Text('选择城市').fontSize(13).fontColor('#707D76').width('100%')
          Select(this.cityOptions()).selected(this.cityIndex).value(this.city().name).width('100%')
            .onSelect((index: number) => { this.cityIndex = index; this.load(); })
          Button(this.loading ? '正在获取天气…' : '刷新天气').width('100%')
            .backgroundColor(this.green).enabled(!this.loading).onClick(() => this.load())
        }.padding(18).width('100%').backgroundColor('#FFFFFF').borderRadius(18).margin({ bottom: 20 })
        if (this.loading) {
          Column({ space: 14 }) {
            LoadingProgress().width(40).height(40).color(this.green)
            Text('正在查询' + this.city().name + '，请稍候…').fontColor('#707D76')
          }.width('100%').padding(30)
        } else if (this.error) {
          Column({ space: 16 }) {
            Text(this.error).fontSize(15).fontColor('#A83B31').textAlign(TextAlign.Center)
            Button('重试').backgroundColor(this.green).onClick(() => this.load())
          }.width('100%').padding(24).backgroundColor('#F8E7E1').borderRadius(18)
        } else if (this.report) {
          this.Conditions(this.report)
        }
      }.width('100%').constraintSize({ maxWidth: 640 }).padding({ left: 22, right: 22, bottom: 32 })
    }.width('100%').height('100%').backgroundColor('#F5F2EB').scrollBar(BarState.Off)
  }
}
