/**
 * Offline province/city coordinates from QWeather LocationList China-City-List v202506200.
 * See doc/城市数据.md for source, coverage and representative-location limitations.
 */
export interface WeatherCity {
  name: string;
  latitude: number;
  longitude: number;
}

export interface WeatherProvince {
  name: string;
  cities: WeatherCity[];
}

export const WEATHER_PROVINCES: WeatherProvince[] = [
  {
    name: '北京市',
    cities: [
      { name: '北京市', latitude: 39.905, longitude: 116.4053 },
    ]
  },
  {
    name: '上海市',
    cities: [
      { name: '上海市', latitude: 31.2317, longitude: 121.4726 },
    ]
  },
  {
    name: '天津市',
    cities: [
      { name: '天津市', latitude: 39.1256, longitude: 117.1902 },
    ]
  },
  {
    name: '重庆市',
    cities: [
      { name: '重庆市', latitude: 29.5638, longitude: 106.5505 },
    ]
  },
  {
    name: '黑龙江省',
    cities: [
      { name: '哈尔滨市', latitude: 45.803, longitude: 126.5351 },
      { name: '齐齐哈尔市', latitude: 47.3421, longitude: 123.9579 },
      { name: '牡丹江市', latitude: 44.583, longitude: 129.6186 },
      { name: '佳木斯市', latitude: 46.8096, longitude: 130.3616 },
      { name: '绥化市', latitude: 46.6374, longitude: 126.9929 },
      { name: '黑河市', latitude: 50.2496, longitude: 127.499 },
      { name: '大兴安岭地区', latitude: 50.4113, longitude: 124.1179 },
      { name: '伊春市', latitude: 47.7269, longitude: 128.8993 },
      { name: '大庆市', latitude: 46.5907, longitude: 125.1127 },
      { name: '七台河市', latitude: 45.7713, longitude: 131.0156 },
      { name: '鸡西市', latitude: 45.3, longitude: 130.976 },
      { name: '鹤岗市', latitude: 47.3321, longitude: 130.2775 },
      { name: '双鸭山市', latitude: 46.6434, longitude: 131.1573 },
    ]
  },
  {
    name: '吉林省',
    cities: [
      { name: '长春市', latitude: 43.817, longitude: 125.3236 },
      { name: '吉林市', latitude: 43.8436, longitude: 126.553 },
      { name: '延边朝鲜族自治州', latitude: 42.907, longitude: 129.5158 },
      { name: '四平市', latitude: 43.1703, longitude: 124.3708 },
      { name: '通化市', latitude: 41.7212, longitude: 125.9365 },
      { name: '白城市', latitude: 45.619, longitude: 122.8411 },
      { name: '辽源市', latitude: 42.9027, longitude: 125.1453 },
      { name: '松原市', latitude: 45.1182, longitude: 124.8236 },
      { name: '白山市', latitude: 41.9425, longitude: 126.4278 },
    ]
  },
  {
    name: '辽宁省',
    cities: [
      { name: '沈阳市', latitude: 41.6776, longitude: 123.4647 },
      { name: '大连市', latitude: 38.9146, longitude: 121.6186 },
      { name: '鞍山市', latitude: 41.1106, longitude: 122.9956 },
      { name: '抚顺市', latitude: 41.8813, longitude: 123.9571 },
      { name: '本溪市', latitude: 41.4868, longitude: 123.685 },
      { name: '丹东市', latitude: 40.0007, longitude: 124.3544 },
      { name: '锦州市', latitude: 41.1193, longitude: 121.1357 },
      { name: '营口市', latitude: 40.6674, longitude: 122.2352 },
      { name: '阜新市', latitude: 42.022, longitude: 121.6701 },
      { name: '辽阳市', latitude: 41.2694, longitude: 123.1815 },
      { name: '铁岭市', latitude: 42.2233, longitude: 123.7257 },
      { name: '朝阳市', latitude: 41.5768, longitude: 120.4512 },
      { name: '盘锦市', latitude: 40.7196, longitude: 122.1707 },
      { name: '葫芦岛市', latitude: 40.711, longitude: 120.8368 },
    ]
  },
  {
    name: '内蒙古自治区',
    cities: [
      { name: '呼和浩特市', latitude: 40.8421, longitude: 111.7488 },
      { name: '包头市', latitude: 40.6213, longitude: 109.9532 },
      { name: '乌海市', latitude: 39.6737, longitude: 106.8256 },
      { name: '乌兰察布市', latitude: 41.0341, longitude: 113.1145 },
      { name: '通辽市', latitude: 43.6174, longitude: 122.2631 },
      { name: '赤峰市', latitude: 42.2569, longitude: 118.8876 },
      { name: '鄂尔多斯市', latitude: 39.6087, longitude: 109.7825 },
      { name: '巴彦淖尔市', latitude: 40.7574, longitude: 107.417 },
      { name: '锡林郭勒盟', latitude: 43.9443, longitude: 116.0919 },
      { name: '呼伦贝尔市', latitude: 49.1665, longitude: 119.7785 },
      { name: '兴安盟', latitude: 46.0763, longitude: 122.0703 },
      { name: '阿拉善盟', latitude: 38.8448, longitude: 105.7064 },
    ]
  },
  {
    name: '河北省',
    cities: [
      { name: '石家庄市', latitude: 38.0455, longitude: 114.5025 },
      { name: '保定市', latitude: 38.8677, longitude: 115.4823 },
      { name: '张家口市', latitude: 40.8119, longitude: 114.8841 },
      { name: '承德市', latitude: 40.9762, longitude: 117.9392 },
      { name: '唐山市', latitude: 39.6351, longitude: 118.1754 },
      { name: '廊坊市', latitude: 39.5239, longitude: 116.7044 },
      { name: '沧州市', latitude: 38.3106, longitude: 116.8575 },
      { name: '衡水市', latitude: 37.7351, longitude: 115.666 },
      { name: '邢台市', latitude: 37.0602, longitude: 114.4974 },
      { name: '邯郸市', latitude: 36.6123, longitude: 114.4907 },
      { name: '秦皇岛市', latitude: 39.8882, longitude: 119.5202 },
      { name: '雄安新区', latitude: 39.0432, longitude: 115.8672 },
    ]
  },
  {
    name: '山西省',
    cities: [
      { name: '太原市', latitude: 37.857, longitude: 112.5492 },
      { name: '大同市', latitude: 40.0971, longitude: 113.3668 },
      { name: '阳泉市', latitude: 37.8612, longitude: 113.5833 },
      { name: '晋中市', latitude: 37.6965, longitude: 112.7365 },
      { name: '长治市', latitude: 36.1911, longitude: 113.1136 },
      { name: '晋城市', latitude: 35.4976, longitude: 112.8513 },
      { name: '临汾市', latitude: 36.0841, longitude: 111.518 },
      { name: '运城市', latitude: 35.0228, longitude: 111.004 },
      { name: '朔州市', latitude: 39.3313, longitude: 112.4334 },
      { name: '忻州市', latitude: 38.4177, longitude: 112.7335 },
      { name: '吕梁市', latitude: 37.5244, longitude: 111.1343 },
    ]
  },
  {
    name: '陕西省',
    cities: [
      { name: '西安市', latitude: 34.3432, longitude: 108.9397 },
      { name: '咸阳市', latitude: 34.3334, longitude: 108.7051 },
      { name: '延安市', latitude: 36.6501, longitude: 109.4947 },
      { name: '榆林市', latitude: 38.2902, longitude: 109.7412 },
      { name: '渭南市', latitude: 34.4994, longitude: 109.5029 },
      { name: '商洛市', latitude: 33.8683, longitude: 109.9398 },
      { name: '安康市', latitude: 32.6903, longitude: 109.0293 },
      { name: '汉中市', latitude: 33.0777, longitude: 107.0286 },
      { name: '宝鸡市', latitude: 34.3629, longitude: 107.2377 },
      { name: '铜川市', latitude: 34.9166, longitude: 108.9796 },
    ]
  },
  {
    name: '山东省',
    cities: [
      { name: '济南市', latitude: 36.6521, longitude: 117.1201 },
      { name: '青岛市', latitude: 36.083, longitude: 120.3552 },
      { name: '淄博市', latitude: 36.8149, longitude: 118.0476 },
      { name: '德州市', latitude: 37.454, longitude: 116.3074 },
      { name: '烟台市', latitude: 37.4646, longitude: 121.4478 },
      { name: '潍坊市', latitude: 36.7093, longitude: 119.1071 },
      { name: '济宁市', latitude: 35.4154, longitude: 116.5872 },
      { name: '泰安市', latitude: 36.195, longitude: 117.1291 },
      { name: '临沂市', latitude: 35.1038, longitude: 118.3565 },
      { name: '菏泽市', latitude: 35.2465, longitude: 115.4694 },
      { name: '滨州市', latitude: 37.3835, longitude: 118.017 },
      { name: '东营市', latitude: 37.434, longitude: 118.6746 },
      { name: '威海市', latitude: 37.5097, longitude: 122.1164 },
      { name: '枣庄市', latitude: 34.8109, longitude: 117.3238 },
      { name: '日照市', latitude: 35.4169, longitude: 119.5269 },
      { name: '聊城市', latitude: 36.456, longitude: 115.9804 },
    ]
  },
  {
    name: '新疆维吾尔自治区',
    cities: [
      { name: '乌鲁木齐市', latitude: 43.7928, longitude: 87.6177 },
      { name: '克拉玛依市', latitude: 45.5959, longitude: 84.8739 },
      { name: '石河子市', latitude: 44.3059, longitude: 86.0411 },
      { name: '昌吉回族自治州', latitude: 44.0146, longitude: 87.304 },
      { name: '吐鲁番市', latitude: 42.9476, longitude: 89.1841 },
      { name: '巴音郭楞蒙古自治州', latitude: 41.7631, longitude: 86.146 },
      { name: '阿拉尔市', latitude: 40.5419, longitude: 81.2859 },
      { name: '阿克苏地区', latitude: 41.1707, longitude: 80.2651 },
      { name: '喀什地区', latitude: 39.4677, longitude: 75.9891 },
      { name: '伊犁哈萨克自治州', latitude: 43.9222, longitude: 81.3163 },
      { name: '塔城地区', latitude: 46.7463, longitude: 82.984 },
      { name: '哈密市', latitude: 42.8332, longitude: 93.5132 },
      { name: '和田地区', latitude: 37.1089, longitude: 79.9275 },
      { name: '阿勒泰地区', latitude: 47.8489, longitude: 88.1387 },
      { name: '克孜勒苏柯尔克孜自治州', latitude: 39.7129, longitude: 76.1739 },
      { name: '博尔塔拉蒙古自治州', latitude: 44.8539, longitude: 82.0514 },
      { name: '图木舒克市', latitude: 39.8673, longitude: 79.078 },
      { name: '五家渠市', latitude: 44.1674, longitude: 87.5269 },
      { name: '铁门关市', latitude: 41.863, longitude: 85.6703 },
      { name: '昆玉市', latitude: 37.2154, longitude: 79.2702 },
      { name: '北屯市', latitude: 47.3532, longitude: 87.8249 },
      { name: '双河市', latitude: 44.8405, longitude: 82.3537 },
      { name: '可克达拉市', latitude: 43.9404, longitude: 80.9942 },
      { name: '胡杨河市', latitude: 44.6926, longitude: 84.8275 },
      { name: '新星市', latitude: 42.7966, longitude: 93.7485 },
      { name: '白杨市', latitude: 46.7266, longitude: 82.8947 },
    ]
  },
  {
    name: '西藏自治区',
    cities: [
      { name: '拉萨市', latitude: 29.6604, longitude: 91.1322 },
      { name: '日喀则市', latitude: 29.2675, longitude: 88.8851 },
      { name: '山南市', latitude: 29.236, longitude: 91.7665 },
      { name: '林芝市', latitude: 29.6547, longitude: 94.3624 },
      { name: '昌都市', latitude: 31.1369, longitude: 97.1785 },
      { name: '那曲市', latitude: 31.476, longitude: 92.0602 },
      { name: '阿里地区', latitude: 32.5032, longitude: 80.1055 },
    ]
  },
  {
    name: '青海省',
    cities: [
      { name: '西宁市', latitude: 36.6232, longitude: 101.7789 },
      { name: '海东市', latitude: 36.4735, longitude: 102.4106 },
      { name: '黄南藏族自治州', latitude: 35.5163, longitude: 102.0176 },
      { name: '海南藏族自治州', latitude: 36.2803, longitude: 100.6196 },
      { name: '果洛藏族自治州', latitude: 34.4734, longitude: 100.2435 },
      { name: '玉树藏族自治州', latitude: 33.0041, longitude: 97.0085 },
      { name: '海西蒙古族藏族自治州', latitude: 37.3746, longitude: 97.3701 },
      { name: '海北藏族自治州', latitude: 36.8967, longitude: 100.9945 },
    ]
  },
  {
    name: '甘肃省',
    cities: [
      { name: '兰州市', latitude: 36.058, longitude: 103.8236 },
      { name: '定西市', latitude: 35.5796, longitude: 104.6263 },
      { name: '平凉市', latitude: 35.5428, longitude: 106.6847 },
      { name: '庆阳市', latitude: 35.7342, longitude: 107.6384 },
      { name: '武威市', latitude: 37.93, longitude: 102.6347 },
      { name: '金昌市', latitude: 38.5142, longitude: 102.1879 },
      { name: '张掖市', latitude: 38.9329, longitude: 100.4555 },
      { name: '酒泉市', latitude: 39.744, longitude: 98.5108 },
      { name: '天水市', latitude: 34.5785, longitude: 105.725 },
      { name: '陇南市', latitude: 33.3886, longitude: 104.9294 },
      { name: '临夏回族自治州', latitude: 35.5994, longitude: 103.2116 },
      { name: '甘南藏族自治州', latitude: 34.986, longitude: 102.9115 },
      { name: '白银市', latitude: 36.5457, longitude: 104.1736 },
      { name: '嘉峪关市', latitude: 39.7865, longitude: 98.2773 },
    ]
  },
  {
    name: '宁夏回族自治区',
    cities: [
      { name: '银川市', latitude: 38.4664, longitude: 106.2782 },
      { name: '石嘴山市', latitude: 39.0133, longitude: 106.3762 },
      { name: '吴忠市', latitude: 37.9862, longitude: 106.1994 },
      { name: '固原市', latitude: 36.0046, longitude: 106.2852 },
      { name: '中卫市', latitude: 37.515, longitude: 105.1896 },
    ]
  },
  {
    name: '河南省',
    cities: [
      { name: '郑州市', latitude: 34.758, longitude: 113.6654 },
      { name: '安阳市', latitude: 36.1034, longitude: 114.3525 },
      { name: '新乡市', latitude: 35.3036, longitude: 113.9268 },
      { name: '许昌市', latitude: 34.023, longitude: 113.8261 },
      { name: '平顶山市', latitude: 33.7666, longitude: 113.1926 },
      { name: '信阳市', latitude: 32.1233, longitude: 114.075 },
      { name: '南阳市', latitude: 32.9991, longitude: 112.5409 },
      { name: '开封市', latitude: 34.7971, longitude: 114.3414 },
      { name: '洛阳市', latitude: 34.6197, longitude: 112.4539 },
      { name: '商丘市', latitude: 34.4371, longitude: 115.6505 },
      { name: '焦作市', latitude: 35.239, longitude: 113.2383 },
      { name: '鹤壁市', latitude: 35.7482, longitude: 114.2954 },
      { name: '濮阳市', latitude: 35.7682, longitude: 115.0413 },
      { name: '周口市', latitude: 33.6347, longitude: 114.7012 },
      { name: '漯河市', latitude: 33.5759, longitude: 114.0264 },
      { name: '驻马店市', latitude: 32.9802, longitude: 114.0247 },
      { name: '三门峡市', latitude: 34.7773, longitude: 111.1941 },
      { name: '济源市', latitude: 35.0904, longitude: 112.5901 },
    ]
  },
  {
    name: '江苏省',
    cities: [
      { name: '南京市', latitude: 32.0415, longitude: 118.7674 },
      { name: '无锡市', latitude: 31.4911, longitude: 120.3119 },
      { name: '镇江市', latitude: 32.2044, longitude: 119.4528 },
      { name: '苏州市', latitude: 31.2994, longitude: 120.6196 },
      { name: '南通市', latitude: 32.0162, longitude: 120.8646 },
      { name: '扬州市', latitude: 32.3932, longitude: 119.421 },
      { name: '盐城市', latitude: 33.3776, longitude: 120.14 },
      { name: '徐州市', latitude: 34.2042, longitude: 117.2838 },
      { name: '淮安市', latitude: 33.5515, longitude: 119.1132 },
      { name: '连云港市', latitude: 34.6, longitude: 119.1788 },
      { name: '常州市', latitude: 31.7728, longitude: 119.947 },
      { name: '泰州市', latitude: 32.4849, longitude: 119.9152 },
      { name: '宿迁市', latitude: 33.963, longitude: 118.2752 },
    ]
  },
  {
    name: '湖北省',
    cities: [
      { name: '武汉市', latitude: 30.5844, longitude: 114.2986 },
      { name: '襄阳市', latitude: 32.0424, longitude: 112.1442 },
      { name: '鄂州市', latitude: 30.3965, longitude: 114.8906 },
      { name: '孝感市', latitude: 30.9264, longitude: 113.9267 },
      { name: '黄冈市', latitude: 30.4477, longitude: 114.8794 },
      { name: '黄石市', latitude: 30.2201, longitude: 115.077 },
      { name: '咸宁市', latitude: 29.8328, longitude: 114.329 },
      { name: '荆州市', latitude: 30.3269, longitude: 112.2381 },
      { name: '宜昌市', latitude: 30.7026, longitude: 111.2908 },
      { name: '恩施土家族苗族自治州', latitude: 30.2831, longitude: 109.487 },
      { name: '十堰市', latitude: 32.6469, longitude: 110.7879 },
      { name: '神农架林区', latitude: 31.7445, longitude: 110.6715 },
      { name: '随州市', latitude: 31.7175, longitude: 113.3738 },
      { name: '荆门市', latitude: 31.0354, longitude: 112.2043 },
      { name: '天门市', latitude: 30.6531, longitude: 113.1659 },
      { name: '仙桃市', latitude: 30.365, longitude: 113.454 },
      { name: '潜江市', latitude: 30.4212, longitude: 112.8969 },
    ]
  },
  {
    name: '浙江省',
    cities: [
      { name: '杭州市', latitude: 30.246, longitude: 120.2108 },
      { name: '湖州市', latitude: 30.8672, longitude: 120.1024 },
      { name: '嘉兴市', latitude: 30.7627, longitude: 120.7509 },
      { name: '宁波市', latitude: 29.8603, longitude: 121.6245 },
      { name: '绍兴市', latitude: 30.0516, longitude: 120.5829 },
      { name: '台州市', latitude: 28.6614, longitude: 121.4286 },
      { name: '温州市', latitude: 28.0006, longitude: 120.6721 },
      { name: '丽水市', latitude: 28.452, longitude: 119.9218 },
      { name: '金华市', latitude: 29.0895, longitude: 119.6495 },
      { name: '衢州市', latitude: 28.9417, longitude: 118.8726 },
      { name: '舟山市', latitude: 29.9856, longitude: 122.2074 },
    ]
  },
  {
    name: '安徽省',
    cities: [
      { name: '合肥市', latitude: 31.8206, longitude: 117.2273 },
      { name: '蚌埠市', latitude: 32.9397, longitude: 117.3632 },
      { name: '芜湖市', latitude: 31.3526, longitude: 118.4331 },
      { name: '淮南市', latitude: 32.5854, longitude: 117.0186 },
      { name: '马鞍山市', latitude: 31.6894, longitude: 118.5079 },
      { name: '安庆市', latitude: 30.5318, longitude: 117.1154 },
      { name: '宿州市', latitude: 33.6339, longitude: 116.9841 },
      { name: '阜阳市', latitude: 32.897, longitude: 115.8197 },
      { name: '亳州市', latitude: 33.8693, longitude: 115.7829 },
      { name: '黄山市', latitude: 29.7092, longitude: 118.3173 },
      { name: '滁州市', latitude: 32.2559, longitude: 118.3334 },
      { name: '淮北市', latitude: 33.9717, longitude: 116.7947 },
      { name: '铜陵市', latitude: 30.9299, longitude: 117.8166 },
      { name: '宣城市', latitude: 30.9457, longitude: 118.758 },
      { name: '六安市', latitude: 31.7529, longitude: 116.5077 },
      { name: '池州市', latitude: 30.656, longitude: 117.4892 },
    ]
  },
  {
    name: '福建省',
    cities: [
      { name: '福州市', latitude: 26.0753, longitude: 119.3062 },
      { name: '厦门市', latitude: 24.4905, longitude: 118.1102 },
      { name: '宁德市', latitude: 26.6592, longitude: 119.5271 },
      { name: '莆田市', latitude: 25.431, longitude: 119.0076 },
      { name: '泉州市', latitude: 24.8745, longitude: 118.6757 },
      { name: '漳州市', latitude: 24.5109, longitude: 117.6618 },
      { name: '龙岩市', latitude: 25.0916, longitude: 117.0298 },
      { name: '三明市', latitude: 26.2654, longitude: 117.635 },
      { name: '南平市', latitude: 27.3828, longitude: 118.0813 },
    ]
  },
  {
    name: '江西省',
    cities: [
      { name: '南昌市', latitude: 28.6765, longitude: 115.8922 },
      { name: '九江市', latitude: 29.6612, longitude: 115.9536 },
      { name: '上饶市', latitude: 28.4444, longitude: 117.9712 },
      { name: '抚州市', latitude: 27.9839, longitude: 116.3584 },
      { name: '宜春市', latitude: 27.8043, longitude: 114.3911 },
      { name: '吉安市', latitude: 27.1117, longitude: 114.9864 },
      { name: '赣州市', latitude: 25.851, longitude: 114.9403 },
      { name: '景德镇市', latitude: 29.2926, longitude: 117.2147 },
      { name: '萍乡市', latitude: 27.6587, longitude: 113.8872 },
      { name: '新余市', latitude: 27.8108, longitude: 114.9308 },
      { name: '鹰潭市', latitude: 28.2386, longitude: 117.0338 },
    ]
  },
  {
    name: '湖南省',
    cities: [
      { name: '长沙市', latitude: 28.2283, longitude: 112.9389 },
      { name: '湘潭市', latitude: 27.8297, longitude: 112.9441 },
      { name: '株洲市', latitude: 27.8358, longitude: 113.1517 },
      { name: '衡阳市', latitude: 26.9004, longitude: 112.6077 },
      { name: '郴州市', latitude: 25.7936, longitude: 113.0321 },
      { name: '常德市', latitude: 29.0402, longitude: 111.6913 },
      { name: '益阳市', latitude: 28.5701, longitude: 112.355 },
      { name: '娄底市', latitude: 27.7281, longitude: 112.0085 },
      { name: '邵阳市', latitude: 27.2378, longitude: 111.4692 },
      { name: '岳阳市', latitude: 29.3703, longitude: 113.1329 },
      { name: '张家界市', latitude: 29.1274, longitude: 110.4799 },
      { name: '怀化市', latitude: 27.5501, longitude: 109.9782 },
      { name: '永州市', latitude: 26.4345, longitude: 111.608 },
      { name: '湘西土家族苗族自治州', latitude: 28.262, longitude: 109.6984 },
    ]
  },
  {
    name: '贵州省',
    cities: [
      { name: '贵阳市', latitude: 26.6467, longitude: 106.6282 },
      { name: '遵义市', latitude: 27.7219, longitude: 107.0319 },
      { name: '安顺市', latitude: 26.2455, longitude: 105.9322 },
      { name: '黔南布依族苗族自治州', latitude: 26.2582, longitude: 107.517 },
      { name: '黔东南苗族侗族自治州', latitude: 26.583, longitude: 107.9775 },
      { name: '铜仁市', latitude: 27.7183, longitude: 109.1916 },
      { name: '毕节市', latitude: 27.3017, longitude: 105.285 },
      { name: '六盘水市', latitude: 26.5846, longitude: 104.8467 },
      { name: '黔西南布依族苗族自治州', latitude: 25.0886, longitude: 104.898 },
    ]
  },
  {
    name: '四川省',
    cities: [
      { name: '成都市', latitude: 30.573, longitude: 104.0663 },
      { name: '攀枝花市', latitude: 26.5804, longitude: 101.716 },
      { name: '自贡市', latitude: 29.3528, longitude: 104.7734 },
      { name: '绵阳市', latitude: 31.4677, longitude: 104.6791 },
      { name: '南充市', latitude: 30.8372, longitude: 106.1106 },
      { name: '达州市', latitude: 31.2095, longitude: 107.5023 },
      { name: '遂宁市', latitude: 30.5133, longitude: 105.5713 },
      { name: '广安市', latitude: 30.4564, longitude: 106.6334 },
      { name: '巴中市', latitude: 31.8588, longitude: 106.7537 },
      { name: '泸州市', latitude: 28.8891, longitude: 105.4434 },
      { name: '宜宾市', latitude: 28.7602, longitude: 104.6308 },
      { name: '内江市', latitude: 29.5871, longitude: 105.0661 },
      { name: '资阳市', latitude: 30.1222, longitude: 104.6419 },
      { name: '乐山市', latitude: 29.582, longitude: 103.7613 },
      { name: '眉山市', latitude: 30.0483, longitude: 103.8318 },
      { name: '凉山彝族自治州', latitude: 27.8868, longitude: 102.2587 },
      { name: '雅安市', latitude: 29.9877, longitude: 103.001 },
      { name: '甘孜藏族自治州', latitude: 30.0507, longitude: 101.9638 },
      { name: '阿坝藏族羌族自治州', latitude: 31.8998, longitude: 102.2214 },
      { name: '德阳市', latitude: 31.128, longitude: 104.3987 },
      { name: '广元市', latitude: 32.4337, longitude: 105.8298 },
    ]
  },
  {
    name: '广东省',
    cities: [
      { name: '广州市', latitude: 23.1252, longitude: 113.2806 },
      { name: '韶关市', latitude: 24.8013, longitude: 113.5915 },
      { name: '惠州市', latitude: 23.0794, longitude: 114.4126 },
      { name: '梅州市', latitude: 24.2991, longitude: 116.1176 },
      { name: '汕头市', latitude: 23.371, longitude: 116.7085 },
      { name: '深圳市', latitude: 22.547, longitude: 114.0859 },
      { name: '珠海市', latitude: 22.2716, longitude: 113.5769 },
      { name: '佛山市', latitude: 23.0288, longitude: 113.1227 },
      { name: '肇庆市', latitude: 23.0515, longitude: 112.4725 },
      { name: '湛江市', latitude: 21.2749, longitude: 110.365 },
      { name: '江门市', latitude: 22.5904, longitude: 113.0949 },
      { name: '河源市', latitude: 23.7463, longitude: 114.6978 },
      { name: '清远市', latitude: 23.685, longitude: 113.0512 },
      { name: '云浮市', latitude: 22.9298, longitude: 112.0444 },
      { name: '潮州市', latitude: 23.6617, longitude: 116.6323 },
      { name: '东莞市', latitude: 23.0462, longitude: 113.7463 },
      { name: '中山市', latitude: 22.5211, longitude: 113.3824 },
      { name: '阳江市', latitude: 21.8592, longitude: 111.9751 },
      { name: '揭阳市', latitude: 23.5438, longitude: 116.3557 },
      { name: '茂名市', latitude: 21.6598, longitude: 110.9192 },
      { name: '汕尾市', latitude: 22.7745, longitude: 115.3642 },
    ]
  },
  {
    name: '云南省',
    cities: [
      { name: '昆明市', latitude: 24.8815, longitude: 102.8337 },
      { name: '大理白族自治州', latitude: 25.5895, longitude: 100.2257 },
      { name: '红河哈尼族彝族自治州', latitude: 23.3668, longitude: 103.3842 },
      { name: '曲靖市', latitude: 25.5016, longitude: 103.7979 },
      { name: '保山市', latitude: 25.1118, longitude: 99.1671 },
      { name: '文山壮族苗族自治州', latitude: 23.3695, longitude: 104.244 },
      { name: '玉溪市', latitude: 24.3505, longitude: 102.5439 },
      { name: '楚雄彝族自治州', latitude: 25.042, longitude: 101.546 },
      { name: '普洱市', latitude: 22.8252, longitude: 100.966 },
      { name: '昭通市', latitude: 27.337, longitude: 103.7172 },
      { name: '临沧市', latitude: 23.8866, longitude: 100.087 },
      { name: '怒江傈僳族自治州', latitude: 25.8509, longitude: 98.8543 },
      { name: '迪庆藏族自治州', latitude: 27.8258, longitude: 99.7087 },
      { name: '丽江市', latitude: 26.8721, longitude: 100.233 },
      { name: '德宏傣族景颇族自治州', latitude: 24.4367, longitude: 98.5784 },
      { name: '西双版纳傣族自治州', latitude: 22.0021, longitude: 100.798 },
    ]
  },
  {
    name: '广西壮族自治区',
    cities: [
      { name: '南宁市', latitude: 22.824, longitude: 108.32 },
      { name: '崇左市', latitude: 22.4041, longitude: 107.3539 },
      { name: '柳州市', latitude: 24.3146, longitude: 109.4117 },
      { name: '来宾市', latitude: 23.7338, longitude: 109.2298 },
      { name: '桂林市', latitude: 25.2356, longitude: 110.1798 },
      { name: '梧州市', latitude: 23.4748, longitude: 111.2976 },
      { name: '贺州市', latitude: 24.4141, longitude: 111.5521 },
      { name: '贵港市', latitude: 23.0936, longitude: 109.6021 },
      { name: '玉林市', latitude: 22.6314, longitude: 110.1544 },
      { name: '百色市', latitude: 23.8977, longitude: 106.6163 },
      { name: '钦州市', latitude: 21.9671, longitude: 108.6242 },
      { name: '河池市', latitude: 24.6959, longitude: 108.0621 },
      { name: '北海市', latitude: 21.4733, longitude: 109.1193 },
      { name: '防城港市', latitude: 21.6867, longitude: 108.3547 },
    ]
  },
  {
    name: '海南省',
    cities: [
      { name: '海口市', latitude: 20.0458, longitude: 110.1984 },
      { name: '三亚市', latitude: 18.2479, longitude: 109.5083 },
      { name: '东方市', latitude: 19.102, longitude: 108.6538 },
      { name: '临高县', latitude: 19.9083, longitude: 109.6877 },
      { name: '澄迈县', latitude: 19.7371, longitude: 110.0071 },
      { name: '儋州市', latitude: 19.5175, longitude: 109.5768 },
      { name: '昌江黎族自治县', latitude: 19.261, longitude: 109.0534 },
      { name: '白沙黎族自治县', latitude: 19.2246, longitude: 109.4526 },
      { name: '琼中黎族苗族自治县', latitude: 19.0356, longitude: 109.84 },
      { name: '定安县', latitude: 19.685, longitude: 110.3492 },
      { name: '屯昌县', latitude: 19.3629, longitude: 110.1028 },
      { name: '琼海市', latitude: 19.246, longitude: 110.4668 },
      { name: '文昌市', latitude: 19.5442, longitude: 110.7975 },
      { name: '保亭黎族苗族自治县', latitude: 18.6364, longitude: 109.7025 },
      { name: '万宁市', latitude: 18.7962, longitude: 110.3888 },
      { name: '陵水黎族自治县', latitude: 18.505, longitude: 110.0372 },
      { name: '乐东黎族自治县', latitude: 18.7476, longitude: 109.1754 },
      { name: '五指山市', latitude: 18.7769, longitude: 109.5167 },
      { name: '三沙市', latitude: 16.831, longitude: 112.3488 },
    ]
  },
  {
    name: '香港特别行政区',
    cities: [
      { name: '香港特别行政区', latitude: 22.307, longitude: 114.177 },
    ]
  },
  {
    name: '澳门特别行政区',
    cities: [
      { name: '澳门特别行政区', latitude: 22.202, longitude: 113.544 },
    ]
  },
  {
    name: '台湾省',
    cities: [
      { name: '宜兰县', latitude: 24.757, longitude: 121.741 },
      { name: '台北市', latitude: 25.0375, longitude: 121.5637 },
      { name: '桃园市', latitude: 24.998, longitude: 121.306 },
      { name: '新竹市', latitude: 24.809, longitude: 120.958 },
      { name: '高雄市', latitude: 22.619, longitude: 120.276 },
      { name: '嘉义市', latitude: 23.487, longitude: 120.441 },
      { name: '台南市', latitude: 23.004, longitude: 120.2 },
      { name: '台东县', latitude: 22.764, longitude: 121.151 },
      { name: '屏东县', latitude: 22.682, longitude: 120.485 },
      { name: '台中市', latitude: 24.144, longitude: 120.67 },
      { name: '苗栗县', latitude: 24.558, longitude: 120.812 },
      { name: '彰化县', latitude: 24.077, longitude: 120.535 },
      { name: '南投县', latitude: 23.916, longitude: 120.685 },
      { name: '花莲县', latitude: 23.983, longitude: 121.603 },
      { name: '新北市', latitude: 25.012, longitude: 121.4657 },
      { name: '嘉义县', latitude: 23.446, longitude: 120.254 },
      { name: '新竹县', latitude: 24.8333, longitude: 121.012 },
      { name: '云林县', latitude: 23.706, longitude: 120.56 },
      { name: '基隆市', latitude: 25.1283, longitude: 121.7419 },
      { name: '澎湖县', latitude: 23.5667, longitude: 119.5833 },
    ]
  },
];
