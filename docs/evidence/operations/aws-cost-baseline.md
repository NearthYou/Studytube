# StudyTube AWS 비용 기준

가격 기준일은 2026-07-30이고, 통화는 USD다. 세금과 환율은 별도로 표시한다. 이 문서는 AWS 콘솔에서 실제 자원과 7월 청구서를 확인한 `production_verified` 예산 기준이다. 계정에는 StudyTube와 무관한 자원도 있으므로 아래 월 예상액은 StudyTube 증분 자원만 계산한다.

## 검증한 실제 인벤토리

2026-07-30 22:06 KST까지 AWS 콘솔에서 다음을 확인했다.

| 서비스 | 실제 상태 |
| --- | --- |
| EC2 | 서울 `ap-northeast-2b`의 `studytube-prod` 1대, `t3.micro`, Linux, running, CPU credit `standard` |
| EBS | `studytube-prod-root` 1개, encrypted gp3 30GiB, 3,000 IOPS, 125MB/s |
| Public IPv4 | 인스턴스에 연결된 Elastic IP `54.116.194.67` 1개 |
| Route 53 | `studytube.page` public hosted zone 1개, apex A가 Elastic IP를 가리킴 |
| S3 | `studytube-releases-555980271919-ap-northeast-2` 1개, public access 차단, versioning과 Object Lock 활성화, Governance 30일 |
| CloudWatch | `/studytube/deploy` log group, 1개월 보존, deletion protection 활성화 |
| SSM | `studytube-prod` managed node online, SSH inbound 없이 운영 |
| SES | `studytube.page` domain identity verified, 계정과 `studytube-transactional` configuration set의 bounce/complaint suppression 활성화, 아직 sandbox |

같은 계정의 `sketchcatch.net` hosted zone과 기타 서비스는 StudyTube 비용에서 제외했다. 계정 전체 hosted zone은 2개지만 StudyTube 증분 수량은 1개다.

## 계산 가정

| 항목 | 가정 | 확인 상태 |
| --- | --- | --- |
| 리전 | 서울 `ap-northeast-2` | 실제 자원에서 확인 |
| 컴퓨팅 | Linux On-Demand `t3.micro`, shared tenancy, 월 730시간 | 실제 인스턴스에서 확인 |
| CPU credit | `standard` | 실제 인스턴스에서 확인 |
| block storage | gp3 30GiB, 기본 3,000 IOPS와 125MB/s | 실제 root volume에서 확인 |
| Public IPv4 | Elastic IP 1개를 인스턴스 실행 시간 동안 유지 | 실제 연결 상태에서 확인 |
| Route 53 | StudyTube hosted zone 1개, 표준 query 월 1만~10만 건 | 실제 hosted zone과 record에서 확인 |
| S3 | Standard 1GB, PUT/LIST 100건, GET 100건 | 실제 bucket은 확인, 사용량은 저사용 예산 가정 |
| CloudWatch | log 수집, 저장, query 각 5GB 이하, standard alarm metric 10개 이하 | 실제 log group은 확인, 사용량은 저사용 예산 가정 |
| SES | 첨부 없는 가입 인증 메일 월 100통 | identity와 suppression 확인, sandbox 실제 발송량 0 |
| 인터넷 전송 | AWS 합산 월 100GB 이하 | 저사용 예산 가정 |

## 24시간 운영 예산

| 항목 | 공식 단가 | 계산 | 월 예상액 |
| --- | ---: | ---: | ---: |
| EC2 `t3.micro` | $0.013/시간 | 730 × 0.013 | $9.490 |
| gp3 30GB | $0.0912/GB-월 | 30 × 0.0912 | $2.736 |
| Public IPv4 | $0.005/시간 | 730 × 0.005 | $3.650 |
| Route 53 hosted zone | $0.50/월 | 1 × 0.50 | $0.500 |
| DNS 표준 query | $0.40/백만 건 | 1만~10만 건 | $0.004~$0.040 |
| S3 Standard와 요청 | 아래 식 참조 | 1GB와 소량 요청 | $0.0255 |
| CloudWatch | 무료 사용 한도 안 | 계산 가정 충족 시 | $0 |
| SES | $0.10 또는 $0.16/1,000통 | 100통 | $0.010~$0.016 |
| 데이터 전송 | 월 첫 100GB 무료 | 100GB 이하 | $0 |

검증한 인벤토리를 24시간 유지할 때 AWS 월 예상액은 약 $16.42~$16.46이다. DNS query, S3 request, CloudWatch, SES, 인터넷 전송은 실제 사용량에 따라 달라진다.

S3 계산식은 다음과 같다.

```text
1GB × $0.025
+ 100 PUT/LIST × $0.0045 / 1,000
+ 100 GET × $0.0035 / 10,000
= $0.025485
```

Object Lock 자체의 고정요금은 없지만, retention 중인 각 object version은 삭제되지 않으므로 실제 저장량에 따라 Standard storage와 요청 요금이 늘어난다.

## 도메인 비용

`studytube.page`는 $14/년에 이미 결제했고, 2027-07-29 만료이며 자동 갱신은 꺼 두었다. 회계상 월 환산액은 약 $1.17이지만 24시간 운영 예산에는 중복 포함하지 않는다. 24시간 AWS 예산과 합친 경제 비용은 월 환산 약 $17.59~$17.62다.

## 실제 청구 관측

2026-07-30 22:06 KST의 7월 AWS Bills 화면은 다음과 같았다.

| 항목 | 관측액 |
| --- | ---: |
| Registrar | $14.00 |
| 세전 서비스 합계 | $14.00 |
| 세금 | $1.40 |
| 7월 pending grand total | $15.40 |

EC2, EBS, Public IPv4, Route 53, S3, CloudWatch의 7월 항목은 당시 아직 $0.00으로 표시됐다. 인스턴스가 7월 29일에 시작됐고 청구 데이터에는 지연이 있으므로, 이 $15.40을 정상 월의 운영비 실측치로 해석하지 않는다. 첫 완전한 24시간 운영 월에는 위의 $16.42~$16.46 예산과 실제 service별 청구를 비교한다.

## 학생 예산 운영 선택지

| 운영 방식 | AWS 월 예상액 | 장점 | 제약 |
| --- | ---: | --- | --- |
| 24시간 운영 | $16.42~$16.46 | 이력서 열람 시 바로 접속 가능 | 가장 비쌈 |
| 하루 8시간, 자동 할당 IP | $7.60~$7.64 | compute와 IPv4 실행 시간만 과금 | 재시작 때 IP가 바뀌므로 DNS 갱신 필요 |
| 하루 8시간, Elastic IP 유지 | $10.05~$10.09 | DNS를 고정하기 쉬움 | 중지 중에도 IPv4 요금 발생 |
| 한 달 내내 중지, 자동 할당 IP 해제 | $3.27~$3.30 | EBS, DNS, artifact만 유지 | 서비스 접속 불가 |
| 한 달 내내 중지, Elastic IP 유지 | $6.92~$6.95 | 주소 보존 | 접속 불가 상태에서도 IPv4 과금 |

지원서 제출과 면접 기간에는 24시간 운영하고, 확인이 끝난 뒤 인스턴스를 중지해 EBS, Route 53, S3만 보존하는 방식이 가장 단순하다. 예약 중지는 서비스 가용 시간과 DNS 갱신 방식을 먼저 정한 뒤 적용한다.

T3의 CPU credit이 `unlimited`이면 기준 CPU를 오래 넘길 때 surplus credit 비용이 생길 수 있다. 비용 상한을 우선하면 `standard`를 사용하고, credit 소진 시 성능이 기준치로 제한되는 tradeoff를 받아들인다.

## 공식 가격 근거

- [Amazon EC2 서울 리전 Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.csv): `t3.micro`와 gp3, price list 유효일 2026-07-01
- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/): 사용 중이거나 유휴 상태인 Public IPv4 시간당 요금
- [Route 53 pricing](https://aws.amazon.com/route53/pricing/): hosted zone과 표준 query 요금, hosted zone은 부분 월 일할 계산하지 않음
- [Amazon S3 서울 리전 Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-2/index.csv): Standard storage와 request 요금
- [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html): retention과 versioning 동작
- [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)과 [서울 리전 Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-2/index.csv): 무료 사용량과 초과 단가
- [SES pricing](https://aws.amazon.com/ses/pricing/)과 [2026 pricing plan 공지](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/): 기존 à-la-carte와 신규 Essentials 단가
- [SES sandbox 제한](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html): 검증된 수신자, 일 200통, 초당 1통 제한
- [EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/): 월 첫 100GB 인터넷 전송 무료 범위
- [EC2 instance lifecycle](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)과 [stop/start 동작](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/how-ec2-instance-stop-start-works.html): 중지 중 compute 과금과 IP 유지 조건
- [T3 Standard mode](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-standard-mode.html)과 [Unlimited mode](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode.html): surplus credit 비용 조건
